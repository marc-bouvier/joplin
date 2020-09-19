const InteropService_Exporter_Base = require('lib/services/InteropService_Exporter_Base');
const { basename, dirname, friendlySafeFilename } = require('lib/path-utils.js');
const BaseModel = require('lib/BaseModel');
const Folder = require('lib/models/Folder');
const Note = require('lib/models/Note');
const { shim } = require('lib/shim');
const moment = require('moment')

// TODO
//  - change output file names to be URL friendly?
//  - Add frontmatter : 
//    - title
//    - tags
//
// ---
// title: "Building a blog with Jekyll and GitHub Pages"
// date: 2018-01-29
// tags: ["Jekyll", "How-To", "Blog", "Markdown", "Github-Pages","JamStack", "Static-Site"]
// description: "Some resources to help building a blog like this one with Jekyll and GitHub pages."
// series: false
// ---



class InteropService_Exporter_Mdf extends InteropService_Exporter_Base {
    async init(destDir) {
        this.destDir_ = destDir;
        this.resourceDir_ = destDir ? `${destDir}/_resources` : null;
        this.createdDirs_ = [];

        await shim.fsDriver().mkdir(this.destDir_);
        await shim.fsDriver().mkdir(this.resourceDir_);
    }

    async makeDirPath_(item, pathPart = null, findUniqueFilename = true) {
        let output = '';
        while (true) {
            if (item.type_ === BaseModel.TYPE_FOLDER) {
                if (pathPart) {
                    output = `${pathPart}/${output}`;
                } else {
                    output = `${friendlySafeFilename(item.title, null, true)}/${output}`;
                    if (findUniqueFilename) output = await shim.fsDriver().findUniqueFilename(output);
                }
            }
            if (!item.parent_id) return output;
            item = await Folder.load(item.parent_id);
        }
    }

    async replaceLinkedItemIdsByRelativePaths_(item) {
        const relativePathToRoot = await this.makeDirPath_(item, '..');

        const newBody = await this.replaceResourceIdsByRelativePaths_(item.body, relativePathToRoot);
        return await this.replaceNoteIdsByRelativePaths_(newBody, relativePathToRoot);
    }


    async frontmatter_(item, tags = []) {
        const formattedCreationDate = moment(item.created_time).format("YYYY-MM-DD");
        const tagsList = tags.map(it => `"${it.title}"`).join(", ")
        let firstLine = "";
        if (item.body) {
            firstLine = item.body.split('\n').shift();
        }
        const frontmatter =
            `---
title: "${item.title}"
date: ${formattedCreationDate}
tags: [${tagsList}]
description: "${firstLine}"
series: false
---

`;
        // Description : first line (500 chars)
        // fetch tags
        return frontmatter;
    }

    async replaceResourceIdsByRelativePaths_(noteBody, relativePathToRoot) {
        const linkedResourceIds = await Note.linkedResourceIds(noteBody);
        const resourcePaths = this.context() && this.context().resourcePaths ? this.context().resourcePaths : {};

        const createRelativePath = function (resourcePath) {
            return `${relativePathToRoot}_resources/${basename(resourcePath)}`;
        };
        return await this.replaceItemIdsByRelativePaths_(noteBody, linkedResourceIds, resourcePaths, createRelativePath);
    }

    async replaceNoteIdsByRelativePaths_(noteBody, relativePathToRoot) {
        const linkedNoteIds = await Note.linkedNoteIds(noteBody);
        const notePaths = this.context() && this.context().notePaths ? this.context().notePaths : {};

        const createRelativePath = function (notePath) {
            return encodeURI(`${relativePathToRoot}${notePath}`.trim());
        };
        return await this.replaceItemIdsByRelativePaths_(noteBody, linkedNoteIds, notePaths, createRelativePath);
    }

    async replaceItemIdsByRelativePaths_(noteBody, linkedItemIds, paths, fn_createRelativePath) {
        let newBody = noteBody;

        for (let i = 0; i < linkedItemIds.length; i++) {
            const id = linkedItemIds[i];
            const itemPath = fn_createRelativePath(paths[id]);
            newBody = newBody.replace(new RegExp(`:/${id}`, 'g'), itemPath);
        }

        return newBody;
    }

    async prepareForProcessingItemType(type, itemsToExport) {
        if (type === BaseModel.TYPE_NOTE) {
            // Create unique file path for the note
            const context = {
                notePaths: {},
            };
            for (let i = 0; i < itemsToExport.length; i++) {
                const itemType = itemsToExport[i].type;

                if (itemType !== type) continue;

                const itemOrId = itemsToExport[i].itemOrId;
                const note = typeof itemOrId === 'object' ? itemOrId : await Note.load(itemOrId);

                if (!note) continue;

                let notePath = `${await this.makeDirPath_(note, null, false)}${friendlySafeFilename(note.title, null, true)}.md`;
                notePath = await shim.fsDriver().findUniqueFilename(`${this.destDir_}/${notePath}`, Object.values(context.notePaths));
                context.notePaths[note.id] = notePath;
            }

            // Strip the absolute path to export dir and keep only the relative paths
            const destDir = this.destDir_;
            Object.keys(context.notePaths).map(function (id) {
                context.notePaths[id] = context.notePaths[id].substr(destDir.length + 1);
            });

            this.updateContext(context);
        }
    }

    async processItem(ItemClass, item, additionalData = { tags: [] }) {
        if ([BaseModel.TYPE_NOTE, BaseModel.TYPE_FOLDER].indexOf(item.type_) < 0) return;

        if (item.type_ === BaseModel.TYPE_FOLDER) {
            const dirPath = `${this.destDir_}/${await this.makeDirPath_(item)}`;

            if (this.createdDirs_.indexOf(dirPath) < 0) {
                await shim.fsDriver().mkdir(dirPath);
                this.createdDirs_.push(dirPath);
            }

        } else if (item.type_ === BaseModel.TYPE_NOTE) {
            const notePaths = this.context() && this.context().notePaths ? this.context().notePaths : {};
            const noteFilePath = `${this.destDir_}/${notePaths[item.id]}`;
            let tags;
            if (additionalData.tags) {
                tags = additionalData.tags
            } else {
                tags = []
            }
            const frontmatter = await this.frontmatter_(item, tags)
            const noteBody = await this.replaceLinkedItemIdsByRelativePaths_(item);
            const noteContent = frontmatter + noteBody;
            // const modNote = Object.assign({}, item, { body: noteBody });
            //       const noteContent = await Note.serializeForEdit(modNote);
            await shim.fsDriver().mkdir(dirname(noteFilePath));
            await shim.fsDriver().writeFile(noteFilePath, noteContent, 'utf-8');
        }
    }

    async processResource(resource, filePath) {
        const destResourcePath = `${this.resourceDir_}/${basename(filePath)}`;
        await shim.fsDriver().copy(filePath, destResourcePath);
    }

    async close() { }
}

module.exports = InteropService_Exporter_Mdf;
