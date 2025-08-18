#!/usr/bin/env ruby
# frozen_string_literal: true

# laurent.martin.aspera@fr.ibm.com
# Aspera on Cloud
# Send a package to shared inbox (name in config file) in given workspace (name in config file)

require_relative '../utils/configuration'
require_relative '../utils/transfer_client'
require_relative '../utils/rest'
require 'logger'
require 'base64'
require 'securerandom'

AOC_API_V1_BASE_URL = 'https://api.ibmaspera.com/api/v1'
AOC_OAUTH_AUDIENCE = 'https://api.asperafiles.com/api/v1/oauth2/token'

PACKAGE_NAME        = 'sample package Ruby'
TRANSFER_SESSIONS   = 1

config = Utils::Configuration.instance
transfer_client = Utils::TransferClient.new(config).startup

def generate_cookie(app, user_name, user_id)
  encoded_app       = Base64.strict_encode64(app)
  encoded_user_name = Base64.strict_encode64(user_name)
  encoded_user_id   = Base64.strict_encode64(user_id)
  "aspera.aoc:#{encoded_app}:#{encoded_user_name}:#{encoded_user_id}"
end

begin
  logger = config.logger
  aoc_api = Utils::Rest.new(AOC_API_V1_BASE_URL)
  aoc_api.auth_bearer(
    {
      token_url: "#{AOC_API_V1_BASE_URL}/oauth2/#{config.param('aoc', 'org')}/token",
      key_pem_path: config.param('aoc', 'private_key'),
      client_id: config.param('aoc', 'client_id'),
      client_secret: config.param('aoc', 'client_secret'),
      iss: config.param('aoc', 'client_id'),
      aud: AOC_OAUTH_AUDIENCE,
      sub: config.param('aoc', 'user_email'),
      org: config.param('aoc', 'org')
    }
  )
  aoc_api.default_scope('user:all')

  # Get my user information
  user_info = aoc_api.read('self')
  logger.debug(user_info)

  # Get workspace information
  workspace_name = config.param('aoc', 'workspace')
  logger.info("getting workspace information for #{workspace_name}")
  response_data = aoc_api.read('workspaces', { 'q' => workspace_name })
  logger.debug(response_data)
  raise "Found #{response_data.size} workspace(s) for #{workspace_name}" unless response_data.size == 1

  workspace_info = response_data.first

  #---------------
  # Packages
  #===============

  # Get shared inbox information
  shared_inbox_name = config.param('aoc', 'shared_inbox')
  logger.info('getting shared inbox information')
  response_data = aoc_api.read('dropboxes',
                               { 'current_workspace_id' => workspace_info['id'], 'q' => shared_inbox_name })
  logger.debug(response_data)
  raise "Found #{response_data.size} dropbox for #{shared_inbox_name}" unless response_data.size == 1

  dropbox_info = response_data.first

  # Create a new package
  logger.info('creating package')
  package_info = aoc_api.create('packages', {
                                  'workspace_id' => workspace_info['id'],
                                  'recipients' => [{ 'id' => dropbox_info['id'], 'type' => 'dropbox' }],
                                  'name' => PACKAGE_NAME,
                                  'note' => 'My package note',
                                  'sent' => true,
                                  'transfers_expected' => TRANSFER_SESSIONS
                                })
  logger.debug(package_info)

  # Get node information
  logger.info('getting node information')
  node_info = aoc_api.read("nodes/#{package_info['node_id']}")
  logger.debug(node_info)

  # Build transfer spec
  t_spec = {
    'direction' => 'send',
    'token' => aoc_api.bearer_token_authorization("node.#{node_info['access_key']}:user:all"),
    'tags' => {
      'aspera' => {
        'app' => 'packages',
        'files' => {
          'node_id' => node_info['id'],
          'package_id' => package_info['id'],
          'package_name' => package_info['name'],
          'package_operation' => 'upload',
          'files_transfer_action' => 'upload_package',
          'workspace_name' => workspace_info['name'],
          'workspace_id' => workspace_info['id']
        },
        'node' => {
          'access_key' => node_info['access_key'],
          'file_id' => package_info['contents_file_id']
        },
        'usage_id' => "aspera.files.workspace.#{workspace_info['id']}",
        'xfer_retry' => 3600
      }
    },
    'remote_host' => node_info['host'],
    'remote_user' => 'xfer',
    'ssh_port' => 33_001,
    'fasp_port' => 33_001,
    'cookie' => generate_cookie('packages', user_info['name'], user_info['email']),
    'create_dir' => true,
    'target_rate_kbps' => 2_000_000,
    'paths' => []
  }

  if TRANSFER_SESSIONS != 1
    t_spec['multi_session']           = TRANSFER_SESSIONS
    t_spec['multi_session_threshold'] = 500_000
  end

  # Add file list
  config.add_sources(t_spec, 'paths')

  # Start transfer
  transfer_client.start_transfer_and_wait(t_spec)

  #---------------
  # Files
  #===============

  home_node_api = aoc_api.node_api_from(
    node_id: aoc_api.home[:node_id],
    workspace_id: aoc_api.workspace[:id],
    workspace_name: aoc_api.workspace[:name],
    scope: Aspera::Api::Node::SCOPE_USER
  )

  log.info("node token: #{home_node_api.oauth.token}")

  # upload to home in workspace (Files app)
  transfer_spec = home_node_api.transfer_spec_gen4(aoc_api.home[:file_id], Aspera::Transfer::Spec::DIRECTION_SEND)

  # add list of files to upload
  config.add_sources(transfer_spec, 'paths')
  log.info("spec: #{transfer_spec}")
  # start transfer
  transfer_client.start_transfer_and_wait(transfer_spec)
ensure
  transfer_client.shutdown
end
