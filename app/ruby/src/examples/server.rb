#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents

require_relative '../utils/configuration'
require_relative '../utils/transfer_client'

# Initialize configuration
config = Utils::Configuration.instance

# Initialize transfer client
transfer_client = Utils::TransferClient.new(config).startup

begin
  ##############################################################
  # download using SSH credentials
  server_uri = URI.parse(config.param('server', 'url'))
  # manually build transfer spec
  transfer_spec = {
    'remote_host' => server_uri.host,
    'ssh_port' => server_uri.port,
    'remote_user' => config.param('server', 'username'),
    'remote_password' => config.param('server', 'password'),
    'direction' => 'receive',
    'destination_root' => Dir.tmpdir,
    'paths' => [{ 'source' => config.param('server', 'file_download') }]
  }
  # start transfer in separate thread
  # method returns as soon as transfer thread is created
  # it des not wait for completion, or even for session startup
  transfer_client.start_transfer_and_wait(transfer_spec)
ensure
  transfer_client.shutdown
end
