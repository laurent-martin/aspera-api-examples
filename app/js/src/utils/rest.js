import ky from 'ky';
import fs from 'fs';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Agent } from 'undici';
import { Configuration, logger, logDump } from './configuration.js';

// used when server certificate is not verified (development servers with self-signed certificate)
const INSECURE_AGENT = new Agent({ connect: { rejectUnauthorized: false } });
const JWT_CLIENT_SERVER_OFFSET_SEC = 60;
const JWT_VALIDITY_SEC = 600;
const MIME_JSON = 'application/json';
const MIME_WWW = 'application/x-www-form-urlencoded';
const IETF_GRANT_JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

// log HTTP headers
const DEBUG_HTTP = false;

/**
 * Simple REST client, with Basic or OAuth 2 JWT Bearer authentication.
 */
export class Rest {
    /**
     * Create a REST client.
     * @param {string} baseUrl base URL of the API
     */
    constructor(baseUrl) {
        this.verify = true;
        // fetch with or without verification of server certificate, according to `setVerify`
        const fetchWithVerify = (input, init) => fetch(input, this.verify ? init : { ...init, dispatcher: INSECURE_AGENT });
        // HTTP errors are checked in `send`
        this.http = Rest.addHttpDebug(ky.create({ fetch: fetchWithVerify, throwHttpErrors: false }));
        this.baseUrl = baseUrl;
        this.authData = null;
        this.headers = {};
    }

    /**
     * Add logs of HTTP headers, if enabled with `DEBUG_HTTP`.
     * @param {object} the_ky ky instance
     * @returns {object} ky instance
     */
    static addHttpDebug(the_ky) {
        if (!DEBUG_HTTP) {
            return the_ky;
        }
        return the_ky.extend({
            hooks: {
                beforeRequest: [
                    ({ request }) => {
                        logDump('Request headers', Object.fromEntries(request.headers));
                    }
                ],
                afterResponse: [
                    ({ response }) => {
                        logDump('Response headers', Object.fromEntries(response.headers));
                    }
                ]
            }
        });
    }

    /**
     * Enable or disable the verification of the server certificate.
     * @param {boolean} verify false for development servers with a self-signed certificate
     */
    setVerify(verify) {
        this.verify = verify;
    }

    /**
     * Add headers to all subsequent requests.
     * @param {Object<string, string>} headers header names and values
     */
    addHeaders(headers) {
        this.headers = { ...this.headers, ...headers };
    }

    /**
     * Use Basic authentication.
     * @param {string} user user name
     * @param {string} password password
     */
    setAuthBasic(user, password) {
        this.authData = null;
        this.headers['Authorization'] = Configuration.basicAuthorization(user, password);
    }

    /**
     * Use OAuth 2 Bearer authentication, with a JWT signed with a private key.
     * @param {object} authData `token_url`, `key_pem_path`, `client_id`, `client_secret`, `iss`, `aud`, `sub`, and optionally `org`
     */
    setAuthBearer(authData) {
        const mandatoryKeys = ['token_url', 'aud', 'client_id', 'client_secret', 'key_pem_path', 'iss', 'sub'];
        const missingKeys = mandatoryKeys.filter(key => !(key in authData));

        if (missingKeys.length > 0) {
            throw new Error(`Missing keys in auth data: ${missingKeys.sort().join(', ')}`);
        }
        this.authData = authData;
    }

    /**
     * Generate a bearer token, and use it for all subsequent requests.
     *
     * A new token is generated for each execution of the sample.
     * In real code, the token should be reused until it expires.
     * @param {string|null} [scope] OAuth scope of the token, or none
     */
    async setDefaultScope(scope = null) {
        this.headers['Authorization'] = await this.getBearerToken(scope);
    }

    /**
     * Generate a bearer token, with the JWT Bearer grant.
     * @param {string|null} [scope] OAuth scope of the token, or none
     * @returns {Promise<string>} value of the Authorization header: `Bearer <token>`
     */
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
            jti: randomUUID(),
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
        // the client authenticates with Basic authentication
        const data = await this.send('POST', tokenUrl, {
            headers: {
                'Content-Type': MIME_WWW,
                'Accept': MIME_JSON,
                'Authorization': Configuration.basicAuthorization(this.authData.client_id, this.authData.client_secret),
            },
            body: new URLSearchParams(tokenParameters).toString(),
        });
        return `Bearer ${data.access_token}`;
    }

    /**
     * Send an HTTP request, log request and response bodies, and throw an exception on error.
     * @param {string} method HTTP method
     * @param {string} url URL without query
     * @param {object} options ky options, with request body in `body` (text) or `json` (object)
     * @returns {Promise<object|null>} response data, or none if the response is empty
     */
    async send(method, url, options) {
        logger.debug(`HTTP ${method} ${url}`);
        const requestBody = options.json ? JSON.stringify(options.json) : options.body;
        if (requestBody) {
            logDump('Request body', requestBody);
        }
        const response = await this.http(url, { ...options, method });
        const responseBody = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${method} ${url}: ${responseBody}`);
        }
        if (!responseBody) {
            return null;
        }
        logDump('Response body', responseBody);
        return JSON.parse(responseBody);
    }

    /**
     * Call the API: send a request, and get the response data.
     * @param {string} method HTTP method
     * @param {string} [endpoint] path of the endpoint, relative to the base URL
     * @param {object|null} [body] request data, sent in JSON
     * @param {object|null} [query] query parameters
     * @param {Object<string, string>|null} [headers] additional headers
     * @returns {Promise<object|null>} response data, or none if the response is empty
     */
    async call(method, endpoint = '', body = null, query = null, headers = null) {
        const url = endpoint ? `${this.baseUrl}/${endpoint}` : this.baseUrl;
        const reqHeaders = { ...this.headers, Accept: MIME_JSON };

        if (method === 'POST' || method === 'PUT') {
            reqHeaders['Content-Type'] = MIME_JSON;
        }

        if (headers) {
            Object.assign(reqHeaders, headers);
        }

        const options = {
            headers: reqHeaders,
        };

        if (body) {
            options.json = body;
        }

        if (query) {
            options.searchParams = query;
        }

        const data = await this.send(method, url, options);
        if (method === 'PUT' || method === 'DELETE') {
            return null;
        }
        return data;
    }

    /**
     * Create a resource (HTTP POST).
     * @param {string} endpoint path of the endpoint, relative to the base URL
     * @param {object} data request data, sent in JSON
     * @returns {Promise<object>} response data
     */
    create(endpoint, data) {
        return this.call('POST', endpoint, data);
    }

    /**
     * Read a resource (HTTP GET).
     * @param {string} endpoint path of the endpoint, relative to the base URL
     * @param {object|null} [params] query parameters
     * @returns {Promise<object>} response data
     */
    read(endpoint, params = null) {
        return this.call('GET', endpoint, null, params);
    }

    /**
     * Update a resource (HTTP PUT).
     * @param {string} endpoint path of the endpoint, relative to the base URL
     * @param {object} data request data, sent in JSON
     * @returns {Promise<null>}
     */
    update(endpoint, data) {
        return this.call('PUT', endpoint, data);
    }

    /**
     * Delete a resource (HTTP DELETE).
     * @param {string} endpoint path of the endpoint, relative to the base URL
     * @returns {Promise<null>}
     */
    delete(endpoint) {
        return this.call('DELETE', endpoint);
    }
}

export default Rest;
