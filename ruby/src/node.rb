#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents
# location of ascp can be specified with env var "ascp"
# temp folder can be specified with env var "tmp"

$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..', 'lib'))
require 'test_environment'

Aspera::Log.instance.level = :debug
all_config = TestEnvironment.instance.config
node_conf = all_config['node']
destination_folder = all_config['server_paths']['folder_upload']

##############################################################
# Upload with node authorization
# create rest client for Node API on a public demo system, using public demo credentials
node_api = Aspera::Rest.new(
  base_url: node_conf['url'],
  auth: {
    type: :basic,
    username: node_conf['user'],
    password: node_conf['pass']
  }
)
# request transfer authorization to node for a single transfer (This is a node api v3 call)
send_result = node_api.create(
  'files/upload_setup',
  { transfer_requests: [{ transfer_request: { paths: [{ destination: destination_folder }] } }] }
)[:data]
# we normally have only one transfer spec in list, so just get the first transfer_spec
transfer_spec = send_result['transfer_specs'].first['transfer_spec']
# add list of files to upload
transfer_spec['paths'] = TestEnvironment.instance.files.map { |p| { 'source' => p } }
# set authentication type to "token" (will trigger use of bypass SSH key)
# transfer_spec['authentication'] = 'token'
# start transfer
TestEnvironment.instance.agent.start_transfer(transfer_spec)
# optional: wait for transfer completion helper function to get events
transfer_result = TestEnvironment.instance.agent.wait_for_transfers_completion
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
