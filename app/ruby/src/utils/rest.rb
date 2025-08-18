# frozen_string_literal: true

require 'rest-client'
require 'jwt'
require 'json'
require 'securerandom'
require 'logger'
require 'openssl'
require 'time'

require 'net/http'

module Utils
  class Rest
    attr_accessor :base_url, :auth_data, :verify, :headers

    # Constants
    JWT_CLIENT_SERVER_OFFSET_SEC = 60
    JWT_VALIDITY_SEC = 600
    MIME_JSON = 'application/json'
    MIME_WWW = 'application/x-www-form-urlencoded'
    IETF_GRANT_JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

    class << self
      def logger(logger, http: false)
        @logger = logger
        return unless http

        RestClient.log = logger
        # Enable global Net::HTTP debug output
        Net::HTTP.class_eval do
          alias_method :orig_initialize, :initialize
          def initialize(*args, &block)
            orig_initialize(*args, &block)
            @debug_output = $stderr
          end
        end
      end

      def log
        @logger
      end
    end

    def initialize(base_url)
      @base_url = base_url
      @auth_data = nil
      @verify = true
      @headers = {}
    end

    # Add headers for all subsequent calls
    def add_headers(headers)
      @headers.merge!(headers)
    end

    # Basic authentication
    def auth_basic(user, password)
      @auth_data = nil
      token = ["#{user}:#{password}"].pack('m0') # base64 without newline
      @headers['Authorization'] = "Basic #{token}"
    end

    # Provide OAuth2 bearer parameters for JWT
    def auth_bearer(token_url:, key_pem_path:, aud:, iss:, sub:, client_id:, client_secret: nil, org: nil)
      @auth_data = {
        token_url: token_url,
        client_id: client_id,
        key_pem_path: key_pem_path,
        aud: aud,
        iss: iss,
        sub: sub
      }
      @auth_data[:client_secret] = client_secret if client_secret
      @auth_data[:org] = org if org
    end

    # Set default scope (generates bearer token)
    def default_scope(scope = nil)
      @headers['Authorization'] = bearer_token_authorization(scope)
    end

    # Generate a bearer token
    def bearer_token_authorization(scope = nil)
      raise 'auth_data not set' unless @auth_data

      self.class.log.info('getting API authorization')
      private_key_pem = File.read(@auth_data[:key_pem_path])
      private_key = OpenSSL::PKey::RSA.new(private_key_pem)

      seconds_since_epoch = Time.now.to_i

      jwt_payload = {
        iss: @auth_data[:iss],
        sub: @auth_data[:sub],
        aud: @auth_data[:aud],
        iat: seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC,
        nbf: seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC,
        exp: seconds_since_epoch + JWT_VALIDITY_SEC,
        jti: SecureRandom.uuid
      }
      jwt_payload[:org] = @auth_data[:org] if @auth_data[:org]

      self.class.log.debug(jwt_payload)

      assertion = JWT.encode(jwt_payload, private_key, 'RS256', { typ: 'JWT' })

      token_parameters = {
        client_id: @auth_data[:client_id],
        grant_type: IETF_GRANT_JWT,
        assertion: assertion
      }
      token_parameters[:scope] = scope if scope

      response = RestClient::Request.execute(
        method: :post,
        url: @auth_data[:token_url],
        user: @auth_data[:client_id],
        password: @auth_data[:client_secret],
        payload: URI.encode_www_form(token_parameters),
        headers: {
          content_type: MIME_WWW,
          accept: MIME_JSON,
          accept_encoding: 'identity' # no compression for debug
        },
        verify_ssl: @verify
      )
      response_data = JSON.parse(response.body)
      "Bearer #{response_data['access_token']}"
    end

    # Generic HTTP call
    def call(
      method,
      endpoint: nil,
      body: nil,
      query: nil,
      headers: nil
    )
      url = endpoint ? "#{@base_url}/#{endpoint}" : @base_url
      url = "#{url}?#{URI.encode_www_form(query)}" if query
      req_headers = {}
      req_headers['Accept'] = MIME_JSON unless %w[PUT DELETE].include?(method.to_s.upcase)
      req_headers['Content-Type'] = MIME_JSON if %w[POST PUT].include?(method.to_s.upcase)
      req_headers.merge!(@headers)
      req_headers.merge!(headers) if headers
      params = {
        method: method,
        url: url,
        headers: req_headers,
        verify_ssl: @verify
      }
      params[:payload] = body.to_json if body
      params[:params] = query if query
      response = RestClient::Request.execute(
        **params
      )
      return nil if %w[PUT DELETE].include?(method.to_s.upcase)

      JSON.parse(response.body)
    end

    def create(endpoint, data)
      call(:post, endpoint: endpoint, body: data)
    end

    def read(endpoint, params = nil)
      call(:get, endpoint: endpoint, query: params)
    end

    def update(endpoint, data)
      call(:put, endpoint: endpoint, body: data)
    end

    def delete(endpoint)
      call(:delete, endpoint: endpoint)
    end
  end
end
