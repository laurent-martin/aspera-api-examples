#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents
# location of ascp can be specified with env var "ascp"
# temp folder can be specified with env var "tmp"

require_relative '../utils/configuration'
require_relative '../utils/transfer_client'
require_relative '../utils/rest'

# Initialize configuration
config = Utils::Configuration.instance

# Initialize transfer client
transfer_client = Utils::TransferClient.new(config).startup

begin
  destination_folder = config.param('server', 'folder_upload')

  ##############################################################
  # Upload with node authorization
  # create rest client for Node API on a public demo system, using public demo credentials
  node_api = Utils::Rest.new(config.param('node', 'url'))
  node_api.auth_basic(
    config.param('node', 'username'),
    config.param('node', 'password')
  )
  # Request transfer authorization to node for a single transfer (This is a node api v3 call)
  send_result = node_api.create(
    'files/upload_setup',
    { transfer_requests: [{ transfer_request: { paths: [{ destination: destination_folder }] } }] }
  )
  # we normally have only one transfer spec in list, so just get the first transfer_spec
  transfer_spec = send_result['transfer_specs'].first['transfer_spec']
  # Add list of files to upload
  config.add_sources(transfer_spec, 'paths')
  # Start transfer
  transfer_client.start_transfer_and_wait(transfer_spec)
ensure
  transfer_client.shutdown
end
