import ky from 'ky';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './configuration.js';
/*
import { URL } from 'url';
import * as calendar from 'calendar';
import * as time from 'time';
*/
const JWT_CLIENT_SERVER_OFFSET_SEC = 60;
const JWT_VALIDITY_SEC = 600;
const MIME_JSON = 'application/json';
const MIME_WWW = 'application/x-www-form-urlencoded';
const IETF_GRANT_JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const DEBUG_HTTP = false;

export class Rest {
    constructor(baseUrl) {
        this.api = Rest.addHttpDebug(ky.extend({
            prefixUrl: baseUrl,
        }));
        this.authData = null;
        this.verify = true;
        this.headers = {};
    }

    static addHttpDebug(the_ky) {
        if (!DEBUG_HTTP) {
            return the_ky;
        }
        return the_ky.extend({
            hooks: {
                beforeRequest: [
                    (request) => {
                        logger.debug(`Request: ${request.method.toUpperCase()} ${request.url}`);
                        logger.debug(`Request headers: ${JSON.stringify(request.headers)}`);
                        if (request.body) {
                            logger.debug(`Request body: ${JSON.stringify(request.body)}`);
                        }
                    }
                ],
                afterResponse: [
                    (request, options, response) => {
                        logger.debug(`Response: ${response.status} ${response.url}`);
                        logger.debug(`Response headers: ${JSON.stringify(response.headers)}`);
                        response.clone().text().then((body) => {
                            logger.debug(`Response body: ${body}`);
                        });
                    }
                ]
            }
        });
    }

    setVerify(verify) {
        this.verify = verify;
    }

    addHeaders(headers) {
        this.headers = { ...this.headers, ...headers };
    }

    setAuthBasic(user, password) {
        this.authData = null;
        this.headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
    }

    setAuthBearer(authData) {
        const mandatoryKeys = ['token_url', 'aud', 'client_id', 'client_secret', 'key_pem_path', 'iss', 'sub'];
        const missingKeys = mandatoryKeys.filter(key => !(key in authData));

        if (missingKeys.length > 0) {
            throw new Error(`Missing mandatory keys in auth_data: ${missingKeys.join(', ')}`);
        }
        this.authData = authData;
    }

    async setDefaultScope(scope = null) {
        this.headers['Authorization'] = await this.getBearerToken(scope);
    }

    async getBearerToken(scope = null) {
        const tokenUrl = this.authData.token_url;
        const privateKeyPem = fs.readFileSync(this.authData.key_pem_path, 'utf8');
        const secondsSinceEpoch = Math.floor(Date.now() / 1000);
        const jwtPayload = {
            iss: this.authData.iss,   // issuer
            sub: this.authData.sub,   // subject
            aud: this.authData.aud,   // audience
            iat: secondsSinceEpoch - JWT_CLIENT_SERVER_OFFSET_SEC, // issued at
            nbf: secondsSinceEpoch - JWT_CLIENT_SERVER_OFFSET_SEC, // not before
            exp: secondsSinceEpoch + JWT_VALIDITY_SEC, // expiration
            jti: uuidv4(),
        };
        if (this.authData.org) {
            jwtPayload.org = this.authData.org;
        }
        const tokenParameters = {
            client_id: this.authData.client_id,
            grant_type: IETF_GRANT_JWT,
            assertion: jwt.sign(jwtPayload, privateKeyPem, { algorithm: 'RS256', header: { typ: 'JWT' } }),
        };
        if (scope) {
            tokenParameters.scope = scope;
        }
        var data = await Rest.addHttpDebug(ky)
            .post(tokenUrl, {
                headers: {
                    'Content-Type': MIME_WWW,
                    'Accept': MIME_JSON,
                },
                body: new URLSearchParams(tokenParameters).toString(),
                auth: {
                    username: this.authData.client_id,
                    password: this.authData.client_secret,
                },
                responseType: 'json',
            }).json();
        return `Bearer ${data.access_token}`;
    }

    async call(method, endpoint = '', body = null, query = null, headers = null) {
        const url = query ? `${endpoint}?${new URLSearchParams(query)}` : endpoint;
        const reqHeaders = { ...this.headers, Accept: MIME_JSON };

        if (method === 'POST' || method === 'PUT') {
            reqHeaders['Content-Type'] = MIME_JSON;
        }

        if (headers) {
            Object.assign(reqHeaders, headers);
        }

        const options = {
            method,
            headers: reqHeaders,
        };

        if (body) {
            options.json = body;
        }

        try {
            const response = await this.api(url, options);
            if (method === 'PUT' || method === 'DELETE') {
                return null;
            }
            return response.json();
        } catch (error) {
            console.error('Error in HTTP request:', error);
            throw error;
        }
    }

    create(endpoint, data) {
        return this.call('POST', endpoint, data);
    }

    read(endpoint, params = null) {
        return this.call('GET', endpoint, null, params);
    }

    update(endpoint, data) {
        return this.call('PUT', endpoint, data);
    }

    delete(endpoint) {
        return this.call('DELETE', endpoint);
    }
}

export default Rest;
