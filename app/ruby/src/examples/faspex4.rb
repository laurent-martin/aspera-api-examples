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

  # 1: Faspex 4 API v3
  #---------------

  # create REST API object
  api_v3 = Utils::Rest.new(config.param('faspex', 'url'))
  api_v3.auth_basic(
    config.param('faspex', 'username'),
    config.param('faspex', 'password')
  )

  # very simple api call
  me = api_v3.read('me')
  log.info("me: #{me}")

  # 2: send a package
  #---------------

  # package creation parameters
  package_create_params = { 'delivery' => {
    'title' => 'test package',
    'recipients' => ['aspera.user1@gmail.com'],
    'sources' => [{ 'paths' => config.files }]
  } }
  pkg_created = api_v3.create('send', package_create_params)
  # get transfer specification (normally: only one)
  transfer_spec = pkg_created['xfer_sessions'].first
  # set paths of files to send
  transfer_spec['paths'] = config.files.map { |p| { 'source' => p } }
  # Start transfer
  transfer_client.start_transfer_and_wait(transfer_spec)
ensure
  transfer_client.shutdown
end
