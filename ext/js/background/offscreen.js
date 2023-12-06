/*
 * Copyright (C) 2023  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as wanakana from '../../lib/wanakana.js';
import {ClipboardReader} from '../comm/clipboard-reader.js';
import {invokeMessageHandler} from '../core.js';
import {ArrayBufferUtil} from '../data/sandbox/array-buffer-util.js';
import {DictionaryDatabase} from '../language/dictionary-database.js';
import {JapaneseUtil} from '../language/sandbox/japanese-util.js';
import {Translator} from '../language/translator.js';

/**
 * This class controls the core logic of the extension, including API calls
 * and various forms of communication between browser tabs and external applications.
 */
export class Offscreen {
    /**
     * Creates a new instance.
     */
    constructor() {
        /** @type {JapaneseUtil} */
        this._japaneseUtil = new JapaneseUtil(wanakana);
        /** @type {DictionaryDatabase} */
        this._dictionaryDatabase = new DictionaryDatabase();
        /** @type {Translator} */
        this._translator = new Translator({
            japaneseUtil: this._japaneseUtil,
            database: this._dictionaryDatabase
        });
        /** @type {ClipboardReader} */
        this._clipboardReader = new ClipboardReader({
            // eslint-disable-next-line no-undef
            document: (typeof document === 'object' && document !== null ? document : null),
            pasteTargetSelector: '#clipboard-paste-target',
            richContentPasteTargetSelector: '#clipboard-rich-content-paste-target'
        });

        /** @type {import('offscreen').MessageHandlerMap} */
        const messageHandlers = new Map([
            ['clipboardGetTextOffscreen',    {async: true,  handler: this._getTextHandler.bind(this)}],
            ['clipboardGetImageOffscreen',   {async: true,  handler: this._getImageHandler.bind(this)}],
            ['clipboardSetBrowserOffscreen', {async: false, handler: this._setClipboardBrowser.bind(this)}],
            ['databasePrepareOffscreen',     {async: true,  handler: this._prepareDatabaseHandler.bind(this)}],
            ['getDictionaryInfoOffscreen',   {async: true,  handler: this._getDictionaryInfoHandler.bind(this)}],
            ['databasePurgeOffscreen',       {async: true,  handler: this._purgeDatabaseHandler.bind(this)}],
            ['databaseGetMediaOffscreen',    {async: true,  handler: this._getMediaHandler.bind(this)}],
            ['translatorPrepareOffscreen',   {async: false, handler: this._prepareTranslatorHandler.bind(this)}],
            ['findKanjiOffscreen',           {async: true,  handler: this._findKanjiHandler.bind(this)}],
            ['findTermsOffscreen',           {async: true,  handler: this._findTermsHandler.bind(this)}],
            ['getTermFrequenciesOffscreen',  {async: true,  handler: this._getTermFrequenciesHandler.bind(this)}],
            ['clearDatabaseCachesOffscreen', {async: false, handler: this._clearDatabaseCachesHandler.bind(this)}]
        ]);
        /** @type {import('offscreen').MessageHandlerMap<string>} */
        this._messageHandlers = messageHandlers;

        const onMessage = this._onMessage.bind(this);
        chrome.runtime.onMessage.addListener(onMessage);

        /** @type {?Promise<void>} */
        this._prepareDatabasePromise = null;
    }

    /** @type {import('offscreen').MessageHandler<'clipboardGetTextOffscreen', true>} */
    async _getTextHandler({useRichText}) {
        return await this._clipboardReader.getText(useRichText);
    }

    /** @type {import('offscreen').MessageHandler<'clipboardGetImageOffscreen', true>} */
    async _getImageHandler() {
        return await this._clipboardReader.getImage();
    }

    /** @type {import('offscreen').MessageHandler<'clipboardSetBrowserOffscreen', false>} */
    _setClipboardBrowser({value}) {
        this._clipboardReader.browser = value;
    }

    /** @type {import('offscreen').MessageHandler<'databasePrepareOffscreen', true>} */
    _prepareDatabaseHandler() {
        if (this._prepareDatabasePromise !== null) {
            return this._prepareDatabasePromise;
        }
        this._prepareDatabasePromise = this._dictionaryDatabase.prepare();
        return this._prepareDatabasePromise;
    }

    /** @type {import('offscreen').MessageHandler<'getDictionaryInfoOffscreen', true>} */
    async _getDictionaryInfoHandler() {
        return await this._dictionaryDatabase.getDictionaryInfo();
    }

    /** @type {import('offscreen').MessageHandler<'databasePurgeOffscreen', true>} */
    async _purgeDatabaseHandler() {
        return await this._dictionaryDatabase.purge();
    }

    /** @type {import('offscreen').MessageHandler<'databaseGetMediaOffscreen', true>} */
    async _getMediaHandler({targets}) {
        const media = await this._dictionaryDatabase.getMedia(targets);
        const serializedMedia = media.map((m) => ({...m, content: ArrayBufferUtil.arrayBufferToBase64(m.content)}));
        return serializedMedia;
    }

    /** @type {import('offscreen').MessageHandler<'translatorPrepareOffscreen', false>} */
    _prepareTranslatorHandler({deinflectionReasons}) {
        this._translator.prepare(deinflectionReasons);
    }

    /** @type {import('offscreen').MessageHandler<'findKanjiOffscreen', true>} */
    async _findKanjiHandler({text, options}) {
        /** @type {import('translation').FindKanjiOptions} */
        const modifiedOptions = {
            ...options,
            enabledDictionaryMap: new Map(options.enabledDictionaryMap)
        };
        return await this._translator.findKanji(text, modifiedOptions);
    }

    /** @type {import('offscreen').MessageHandler<'findTermsOffscreen', true>} */
    _findTermsHandler({mode, text, options}) {
        const enabledDictionaryMap = new Map(options.enabledDictionaryMap);
        const excludeDictionaryDefinitions = (
            options.excludeDictionaryDefinitions !== null ?
            new Set(options.excludeDictionaryDefinitions) :
            null
        );
        const textReplacements = options.textReplacements.map((group) => {
            if (group === null) { return null; }
            return group.map((opt) => {
                // https://stackoverflow.com/a/33642463
                const match = opt.pattern.match(/\/(.*?)\/([a-z]*)?$/i);
                const [, pattern, flags] = match !== null ? match : ['', '', ''];
                return {...opt, pattern: new RegExp(pattern, flags ?? '')};
            });
        });
        /** @type {import('translation').FindTermsOptions} */
        const modifiedOptions = {
            ...options,
            enabledDictionaryMap,
            excludeDictionaryDefinitions,
            textReplacements
        };
        return this._translator.findTerms(mode, text, modifiedOptions);
    }

    /** @type {import('offscreen').MessageHandler<'getTermFrequenciesOffscreen', true>} */
    _getTermFrequenciesHandler({termReadingList, dictionaries}) {
        return this._translator.getTermFrequencies(termReadingList, dictionaries);
    }

    /** @type {import('offscreen').MessageHandler<'clearDatabaseCachesOffscreen', false>} */
    _clearDatabaseCachesHandler() {
        this._translator.clearDatabaseCaches();
    }

    /** @type {import('extension').ChromeRuntimeOnMessageCallback} */
    _onMessage({action, params}, sender, callback) {
        const messageHandler = this._messageHandlers.get(action);
        if (typeof messageHandler === 'undefined') { return false; }
        return invokeMessageHandler(messageHandler, params, callback, sender);
    }
}