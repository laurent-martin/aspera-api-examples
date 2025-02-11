#!/usr/bin/env ruby
# frozen_string_literal: true

require 'aspera/api/aoc'
require_relative '../utils/configuration'

test_env = Configuration.instance

log = test_env.log

aoc_org_url = "https://#{test_env.conf('aoc', 'org')}.ibmaspera.com"

aoc_api = Aspera::Api::AoC.new(
  url: aoc_org_url,
  workspace: test_env.conf('aoc', 'workspace'), # nil means: default workspace for the user
  auth: :jwt,
  private_key: File.read(test_env.conf('aoc', 'private_key')),
  username: test_env.conf('aoc', 'user_email'),
  scope: Aspera::Api::AoC::SCOPE_FILES_USER,
  subpath: 'api/v1'
)

self_user_data = aoc_api.read('self')

log.info("self: #{self_user_data}")

# setting application context retrieves workspace and home information (Files)
aoc_api.context = :files

log.info("workspace: #{aoc_api.workspace}")
log.info("home: #{aoc_api.home}")

home_node_api = aoc_api.node_api_from(
  node_id: aoc_api.home[:node_id],
  workspace_id: aoc_api.workspace[:id],
  workspace_name: aoc_api.workspace[:name],
  scope: Aspera::Api::Node::SCOPE_USER
)

log.info("node token: #{home_node_api.oauth.token}")

# upload to home in workspace (Files app)
transfer_spec = home_node_api.transfer_spec_gen4(aoc_api.home[:file_id], Aspera::Transfer::Spec::DIRECTION_SEND)

log.info("spec: #{transfer_spec}")

# add list of files to upload
transfer_spec['paths'] = test_env.files.map { |p| { 'source' => p } }
# start transfer
test_env.agent.start_transfer(transfer_spec)
# optional: wait for transfer completion helper function to get events
transfer_result = test_env.agent.wait_for_transfers_completion
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
