#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents

$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..', 'lib'))
require 'test_environment'

Aspera::Log.instance.level = :debug
all_config = TestEnvironment.instance.config
server_conf = all_config['server']

##############################################################
# download using SSH credentials
server_uri = URI.parse(server_conf['url'])
# manually build transfer spec
transfer_spec = {
  'remote_host' => server_uri.host,
  'ssh_port' => server_uri.port,
  'remote_user' => server_conf['user'],
  'remote_password' => server_conf['pass'],
  'direction' => 'receive',
  'destination_root' => Dir.tmpdir,
  'paths' => [{ 'source' => server_conf['file_download'] }]
}
# start transfer in separate thread
# method returns as soon as transfer thread is created
# it des not wait for completion, or even for session startup
TestEnvironment.instance.agent.start_transfer(transfer_spec)

# optional: helper method: wait for completion of transfers
# here we started a single transfer session (no multi session parameter)
# get array of status, one for each session (so, a single value array)
# each status is either :success or "error message"
transfer_result = TestEnvironment.instance.agent.wait_for_transfers_completion
# get list of errors only
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
