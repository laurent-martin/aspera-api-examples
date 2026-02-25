#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls
# alternatively class RestClient of gem rest-client could be used

require_relative '../utils/configuration'
require_relative '../utils/transfer_client'
require_relative '../utils/rest'

config = Utils::Configuration.instance
transfer_client = Utils::TransferClient.new(config).startup

begin
  log = config.logger

  # 1: Faspex 5 API v5
  #---------------

  # create REST API object
  api_v5 = Utils::Rest.new("#{config.param('faspex5', 'url')}/api/v5")
  api_v5.auth_bearer(
    token_url: "#{config.param('faspex5', 'url')}/auth/token",
    key_pem_path: File.expand_path(config.param('faspex5', 'private_key')),
    client_id: config.param('faspex5', 'client_id'),
    client_secret: config.param('faspex5', 'client_secret'),
    iss: config.param('faspex5', 'client_id'), # issuer
    aud: config.param('faspex5', 'client_id'), # audience
    sub: "user:#{config.param('faspex5', 'username')}" # subject
  )
  api_v5.default_scope

  # very simple api call
  log.debug(api_v5.read('version'))

  # 2: send a package
  #---------------

  # package creation parameters
  package_create_params = {
    'title': 'test title',
    'recipients': [{ 'name': config.param('faspex5', 'username') }]
  }
  package = api_v5.create('packages', package_create_params)
  ts_paths = config.add_sources({}, 'paths')
  transfer_spec = api_v5.call(
    'POST',
    endpoint: "packages/#{package['id']}/transfer_spec/upload",
    headers: { 'Accept' => 'application/json' },
    query: { transfer_type: 'connect' },
    body: ts_paths
  )
  transfer_spec.delete('authentication')
  transfer_spec.merge!(ts_paths)

  log.debug("transfer_spec #{transfer_spec}")
  # Start transfer
  transfer_client.start_transfer_and_wait(transfer_spec)
ensure
  transfer_client.shutdown
end
