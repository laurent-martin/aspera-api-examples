#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import assert from 'assert';
import os from 'os';
import winston from 'winston';

const PATHS_FILE_REL = 'config/paths.yaml';
/** Environment variable for the top directory */
const DIR_TOP_VAR = 'DIR_TOP';

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
 * Parameters from configuration files.
 */
export class Configuration {
	constructor() {
		const dir = process.env[DIR_TOP_VAR];
		if (!dir) throw new Error(`Environment variable ${DIR_TOP_VAR} is not set.`);
		this.topFolder = path.resolve(dir);
		if (!fs.existsSync(this.topFolder) || !fs.lstatSync(this.topFolder).isDirectory()) {
			throw new Error(`The folder specified by ${DIR_TOP_VAR} does not exist or is not a directory: ${this.topFolder}`);
		}
		this.logFolder = os.tmpdir();
		this.tmpFolder = os.tmpdir();
		this.paths = Configuration.loadYAML(path.join(this.topFolder, PATHS_FILE_REL));
		this.config = Configuration.loadYAML(this.getPath('main_config'));
		logger.level = this.getParam('misc', 'level');
	}

	/** Construct path based on topFolder and paths YAML */
	getPath(name) {
		return path.join(this.topFolder, this.paths[name]);
	}

	/**
	 * Get a parameter from the main configuration file
	 * @param {*} section section in the config
	 * @param {*} param parameter in the section
	 * @returns the parameter value
	 */
	getParam(section, param) {
		const sect = this.config[section];
		if (!sect) {
			return undefined;
		}
		return sect[param];
	}

	/**
	 * Add sources to a transfer spec
	 * 
	 * @param {object} tSpec Transfer spec
	 * @param {string} path Path to the sources in the transfer spec
	 * @param {string} destination Destination path for the sources
	 * */
	addSources(tSpec, path, destination = null) {
		const keys = path.split('.');
		let currentNode = tSpec;
		for (let i = 0; i < keys.length - 1; i++) {
			const key = keys[i];
			if (typeof currentNode[key] === 'object' && currentNode[key] !== null) {
				currentNode = currentNode[key];
			} else {
				throw new Error(`Key is not a dictionary: ${key}`);
			}
		}
		const lastKey = keys[keys.length - 1];
		const paths = currentNode[lastKey] = [];
		const fileList = process.argv.slice(2);
		assert(fileList.length, 'ERROR: Provide at least one file path to transfer');
		fileList.forEach((file) => {
			const source = { source: file };
			if (destination) {
				source.destination = path.basename(file);
			}
			paths.push(source);
		});
	}
	/** load and parse YAML file */
	static loadYAML(filePath) {
		return yaml.load(fs.readFileSync(filePath, 'utf8'));
	}

	/** Basic Authorization */
	static basicAuthorization(username, password) {
		return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
	}

	/** Create an auth header for transfer spec v2 */
	static basicAuthHeaderKeyValue(username, password) {
		return {
			key: 'Authorization',
			value: Configuration.basicAuthorization(username, password),
		};
	}

}
