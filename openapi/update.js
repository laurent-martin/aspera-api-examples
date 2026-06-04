#!/usr/bin/env node

/**
 * Script to automatically update menu.html with OpenAPI/Swagger specifications
 * 
 * This script:
 * 1. Scans the current directory for .yaml and .json files
 * 2. Reads each file to determine if it's OpenAPI or Swagger and which version
 * 3. Updates the openApiSpecs array in menu.html
 * 
 * Usage: node update.js
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MENU_FILE = 'menu.html';
const CURRENT_DIR = __dirname;

/**
 * Get all YAML and JSON files in the current directory
 */
function getSpecFiles() {
    const files = fs.readdirSync(CURRENT_DIR);
    return files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return (ext === '.yaml' || ext === '.yml' || ext === '.json') &&
            file !== 'specs.json' &&
            file !== 'package.json' &&
            file !== 'package-lock.json';
    }).sort();
}

/**
 * Parse a spec file and determine its OpenAPI/Swagger version
 */
function parseSpecFile(filename) {
    const filePath = path.join(CURRENT_DIR, filename);
    const ext = path.extname(filename).toLowerCase();

    try {
        let spec;
        const content = fs.readFileSync(filePath, 'utf8');

        if (ext === '.json') {
            spec = JSON.parse(content);
        } else {
            spec = yaml.load(content);
        }

        // Determine spec version
        let specVersion = 'Unknown';

        if (spec.openapi) {
            // OpenAPI 3.x
            const version = spec.openapi;
            if (version.startsWith('3.0')) {
                specVersion = 'OpenAPI 3.0';
            } else if (version.startsWith('3.1')) {
                specVersion = 'OpenAPI 3.1';
            } else {
                specVersion = `OpenAPI ${version}`;
            }
        } else if (spec.swagger) {
            // Swagger 2.0
            specVersion = `Swagger ${spec.swagger}`;
        }

        return {
            filename,
            specVersion
        };
    } catch (error) {
        console.error(`Error parsing ${filename}:`, error.message);
        return {
            filename,
            specVersion: 'Unknown'
        };
    }
}

/**
 * Update the menu.html file with the new specs array
 */
function updateMenuHtml(specs) {
    const menuPath = path.join(CURRENT_DIR, MENU_FILE);

    if (!fs.existsSync(menuPath)) {
        console.error(`Error: ${MENU_FILE} not found`);
        process.exit(1);
    }

    let content = fs.readFileSync(menuPath, 'utf8');

    // Generate the new specs array as a formatted string
    const specsArray = specs.map(spec =>
        `            { filename: '${spec.filename}', specVersion: '${spec.specVersion}' }`
    ).join(',\n');

    const newSpecsBlock = `        // List of OpenAPI files with their spec versions
        const openApiSpecs = [
${specsArray}
        ];`;

    // Replace the existing openApiSpecs array
    const regex = /\/\/ List of OpenAPI files with their spec versions\s+const openApiSpecs = \[[^\]]*\];/s;

    if (regex.test(content)) {
        content = content.replace(regex, newSpecsBlock);
        fs.writeFileSync(menuPath, content, 'utf8');
        console.log(`✅ Successfully updated ${MENU_FILE} with ${specs.length} specifications`);
        return true;
    } else {
        console.error(`Error: Could not find openApiSpecs array in ${MENU_FILE}`);
        return false;
    }
}

/**
 * Main function
 */
function main() {
    console.log('🔍 Scanning for OpenAPI/Swagger specification files...\n');

    const files = getSpecFiles();

    if (files.length === 0) {
        console.log('No specification files found.');
        return;
    }

    console.log(`Found ${files.length} specification file(s):\n`);

    const specs = [];

    for (const file of files) {
        const spec = parseSpecFile(file);
        specs.push(spec);
        console.log(`  📄 ${file}`);
        console.log(`     Version: ${spec.specVersion}\n`);
    }

    console.log('📝 Updating menu.html...\n');

    if (updateMenuHtml(specs)) {
        console.log('\n✨ Done! The menu has been updated successfully.');
    } else {
        console.log('\n❌ Failed to update menu.html');
        process.exit(1);
    }
}

// Run the script
main();
