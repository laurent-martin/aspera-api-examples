#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com

import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import os from 'os';
import winston from 'winston';

const PATHS_FILE_REL = 'config/paths.yaml';
/** Environment variable for the top directory */
const DIR_TOP_VAR = 'DIR_TOP';
/** secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters */
const SECRETS_REGEX = /("[^"]*(?:assertion|authorization|password|private_key|secret|token)"\s*:\s*")[^"]+|(assertion=)[^&]+/g;
/** set from configuration file (misc.show_secrets) */
let showSecrets = false;

/**
 * Hide secrets in text for logs, unless configured to show them.
 * @param {string} text text that may contain secrets
 * @returns {string} text with hidden secrets
 */
export function maskSecrets(text) {
	return showSecrets ? text : text.replace(SECRETS_REGEX, '$1$2***');
}

/** Logger of the samples */
export const logger = winston.createLogger({
	level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
	format: winston.format.combine(
		winston.format.colorize(),
		winston.format.prettyPrint(),
		winston.format.printf(({ level, message, timestamp }) => {
			const formattedMessage = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
			return `${level} ${formattedMessage}`;
		}),
	),
	transports: [
		new winston.transports.Console(),
	],
});

/**
 * Log a named value: objects are displayed in JSON, and secrets are hidden.
 * @param {string} name name of the value
 * @param {*} value value to log: a string, or an object displayed in JSON
 * @param {string} [level='debug'] log level, debug by default
 */
export function logDump(name, value, level = 'debug') {
	if (!logger.isLevelEnabled(level)) return;
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	logger.log(level, `${name}: ${maskSecrets(text)}`);
}

/**
 * Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
 */
export class Configuration {
	/**
	 * Read the configuration file, and set up logging.
	 */
	constructor() {
		this.topFolder = Configuration.findTopFolder();
		this.logFolder = os.tmpdir();
		this.tmpFolder = os.tmpdir();
		this.paths = Configuration.loadYAML(path.join(this.topFolder, PATHS_FILE_REL));
		this.config = Configuration.loadYAML(this.getPath('main_config'));
		// winston uses `warn`
		const level = this.getParam('misc', 'level');
		if (!['debug', 'info', 'warning', 'error'].includes(level)) throw new Error(`Invalid log level: ${level}`);
		logger.level = level === 'warning' ? 'warn' : level;
		showSecrets = this.getParam('misc', 'show_secrets', false);
	}

	/**
	 * Get the path of an item of the project, from the paths file.
	 * @param {string} name name of the item in the paths file
	 * @returns {string} absolute path of the item, that must exist
	 */
	getPath(name) {
		const itemPath = path.join(this.topFolder, this.paths[name]);
		if (!fs.existsSync(itemPath)) throw new Error(`File not found: ${itemPath}`);
		return itemPath;
	}

	/**
	 * Get a parameter from the configuration file.
	 * @param {string} section section in the configuration file
	 * @param {string} param name of the parameter in the section
	 * @param {*} [defaultValue] value if the parameter is not set, else the parameter is mandatory
	 * @returns {*} value of the parameter
	 */
	getParam(section, param, defaultValue = undefined) {
		const sect = this.config[section] ?? {};
		if (!(param in sect)) {
			if (defaultValue !== undefined) return defaultValue;
			throw new Error(`Configuration parameter not found: ${section}.${param}`);
		}
		return sect[param];
	}

	/**
	 * Add the files to transfer, from the command line arguments, to the transfer spec.
	 * @param {object} tSpec transfer spec to modify
	 * @param {string} dotPath path of the file list in the transfer spec: `paths` (V1) or `assets.paths` (V2)
	 * @param {*} [destination] if set, add the file name as destination
	 */
	addSources(tSpec, dotPath, destination = null) {
		const keys = dotPath.split('.');
		let currentNode = tSpec;
		for (let i = 0; i < keys.length - 1; i++) {
			const key = keys[i];
			if (typeof currentNode[key] === 'object' && currentNode[key] !== null) {
				currentNode = currentNode[key];
			} else {
				throw new Error(`Invalid path in transfer spec: ${dotPath}`);
			}
		}
		const lastKey = keys[keys.length - 1];
		const paths = currentNode[lastKey] = [];
		const fileList = process.argv.slice(2);
		if (!fileList.length) throw new Error('Missing arguments: files to transfer');
		fileList.forEach((file) => {
			const source = { source: file };
			if (destination) {
				source.destination = path.basename(file);
			}
			paths.push(source);
		});
	}

	/**
	 * Find the main folder of the repository: from environment variable `DIR_TOP` if set,
	 * else the first folder containing `config/paths.yaml`, from the current folder up.
	 * @returns {string} absolute path of the main folder
	 */
	static findTopFolder() {
		const dir = process.env[DIR_TOP_VAR];
		if (dir) {
			const topFolder = path.resolve(dir);
			if (!fs.existsSync(topFolder) || !fs.lstatSync(topFolder).isDirectory()) {
				throw new Error(`Folder not found: ${topFolder}`);
			}
			return topFolder;
		}
		let folder = process.cwd();
		while (!fs.existsSync(path.join(folder, PATHS_FILE_REL))) {
			const parent = path.dirname(folder);
			if (parent === folder) throw new Error(`Main folder not found: run from inside the repository, or set ${DIR_TOP_VAR}`);
			folder = parent;
		}
		return folder;
	}

	/**
	 * Load a YAML file.
	 * @param {string} filePath path of the YAML file
	 * @returns {*} content of the file
	 */
	static loadYAML(filePath) {
		return yaml.load(fs.readFileSync(filePath, 'utf8'));
	}

	/**
	 * Create the value of an HTTP Basic Authorization header.
	 * @param {string} username user name
	 * @param {string} password password
	 * @returns {string} header value: `Basic <base64>`
	 */
	static basicAuthorization(username, password) {
		return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
	}

	/**
	 * Create an HTTP Basic Authorization header for a transfer spec V2.
	 * @param {string} username user name
	 * @param {string} password password
	 * @returns {{key: string, value: string}} header as `key` and `value`
	 */
	static basicAuthHeaderKeyValue(username, password) {
		return {
			key: 'Authorization',
			value: Configuration.basicAuthorization(username, password),
		};
	}

}
