#!/usr/bin/env ruby
# frozen_string_literal: true

# laurent.martin.aspera@fr.ibm.com
# Upload files using node API and transfer spec v2

require_relative '../utils/configuration'
require_relative '../utils/transfer_client'

# Initialize configuration
config = Utils::Configuration.instance

# Initialize transfer client
transfer_client = Utils::TransferClient.new(config).startup

begin
  # Prepare transfer spec v2 for COS
  t_spec = {
    'title' => 'send using Node API and ts v2',
    'session_initiation' => {
      'node_api' => {
        'url' => config.param('node', 'url'),
        'headers' => [
          Utils::Configuration.basic_auth_header_key_value(
            config.param('node', 'username'),
            config.param('node', 'password')
          )
        ]
      }
    },
    'direction' => 'send',
    'assets' => {
      'destination_root' => config.param('node', 'folder_upload'),
      'paths' => []
    }
  }

  # Add file list in transfer spec
  config.add_sources(t_spec, 'assets.paths')

  # Start transfer
  transfer_client.start_transfer_and_wait(t_spec)
ensure
  transfer_client.shutdown
end
