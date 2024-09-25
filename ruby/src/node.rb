#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents
# location of ascp can be specified with env var "ascp"
# temp folder can be specified with env var "tmp"

require_relative 'utils/test_environment'

test_env = TestEnvironment.instance

destination_folder = test_env.conf('server', 'folder_upload')

##############################################################
# Upload with node authorization
# create rest client for Node API on a public demo system, using public demo credentials
node_api = Aspera::Rest.new(
  base_url: test_env.conf('node', 'url'),
  auth: {
    type: :basic,
    username: test_env.conf('node', 'username'),
    password: test_env.conf('node', 'password')
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
transfer_spec['paths'] = test_env.files.map { |p| { 'source' => p } }
# set authentication type to "token" (will trigger use of bypass SSH key)
# transfer_spec['authentication'] = 'token'
# start transfer
test_env.agent.start_transfer(transfer_spec)
# optional: wait for transfer completion helper function to get events
transfer_result = test_env.agent.wait_for_transfers_completion
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
