#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents

require_relative 'utils/test_environment'

test_env = TestEnvironment.instance

##############################################################
# download using SSH credentials
server_uri = URI.parse(test_env.conf('server', 'url'))
# manually build transfer spec
transfer_spec = {
  'remote_host' => server_uri.host,
  'ssh_port' => server_uri.port,
  'remote_user' => test_env.conf('server', 'username'),
  'remote_password' => test_env.conf('server', 'password'),
  'direction' => 'receive',
  'destination_root' => Dir.tmpdir,
  'paths' => [{ 'source' => test_env.conf('server', 'file_download') }]
}
# start transfer in separate thread
# method returns as soon as transfer thread is created
# it des not wait for completion, or even for session startup
test_env.agent.start_transfer(transfer_spec)

# optional: helper method: wait for completion of transfers
# here we started a single transfer session (no multi session parameter)
# get array of status, one for each session (so, a single value array)
# each status is either :success or "error message"
transfer_result = test_env.agent.wait_for_transfers_completion
# get list of errors only
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
