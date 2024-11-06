#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import assert from 'assert';
import os from 'os';
import winston from 'winston';

export const logger = winston.createLogger({
	level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
	format: winston.format.combine(
		winston.format.colorize(),
		winston.format.printf(({ _, level, message }) => {
			return `${level} ${message}`;
		})
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
		this.pathsFile = 'config/paths.yaml';
		this.topFolder = Configuration.resolveDirectory('DIR_TOP');
		this.logFolder = os.tmpdir();
		this.tmpFolder = os.tmpdir();
		this.paths = Configuration.loadYAML(path.join(this.topFolder, this.pathsFile));
		this.config = Configuration.loadYAML(this.getPath('main_config'));
	}

	/** Static helper to resolve directory based on env variable */
	static resolveDirectory(dirEnvVar) {
		const dir = process.env[dirEnvVar];
		if (!dir) throw new Error(`Environment variable ${dirEnvVar} is not set.`);
		const resolvedDir = path.resolve(dir);
		if (!fs.existsSync(resolvedDir) || !fs.lstatSync(resolvedDir).isDirectory()) {
			throw new Error(`The folder specified by ${dirEnvVar} does not exist or is not a directory: ${resolvedDir}`);
		}
		return resolvedDir;
	}

	/** load YAML files */
	static loadYAML(filePath) {
		return yaml.load(fs.readFileSync(filePath, 'utf8'));
	}

	/** Construct path based on topFolder and paths YAML */
	getPath(name) {
		return path.join(this.topFolder, this.paths[name]);
	}

	getParam(section, param) {
		return this.config[section][param];
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
}
