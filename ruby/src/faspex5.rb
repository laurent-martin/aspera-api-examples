#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls
# alternatively class RestClient of gem rest-client could be used

require_relative 'utils/configuration'

test_env = Configuration.instance

# 1: Faspex 5 API v5
#---------------

# create REST API object
api_v5 = Aspera::Rest.new(
  base_url: "#{test_env.conf('faspex5', 'url')}/api/v5",
  auth: {
    type: :oauth2,
    grant_method: :jwt,
    base_url: "#{test_env.conf('faspex5', 'url')}/auth",
    client_id: test_env.conf('faspex5', 'client_id'),
    payload: {
      iss: test_env.conf('faspex5', 'client_id'), # issuer
      aud: test_env.conf('faspex5', 'client_id'), # audience
      sub: "user:#{test_env.conf('faspex5', 'username')}" # subject
    },
    private_key_obj: OpenSSL::PKey::RSA.new(File.read(File.expand_path(test_env.conf('faspex5', 'private_key'))),
                                            test_env.conf('faspex5', 'passphrase', optional: true)),
    headers: { typ: 'JWT' }
  }
)

# very simple api call
test_env.log.debug(api_v5.read('version'))

# 2: send a package
#---------------

# package creation parameters
package_create_params = {
  'title': 'test title',
  'recipients': [{ 'name': test_env.conf('faspex5', 'username') }]
}
package = api_v5.create('packages', package_create_params)[:data]
ts_paths = { 'paths' => test_env.files.map { |p| { 'source' => p } } }
transfer_spec = api_v5.call(
  operation: 'POST',
  subpath: "packages/#{package['id']}/transfer_spec/upload",
  headers: { 'Accept' => 'application/json' },
  query: { transfer_type: 'connect' },
  body: ts_paths,
  body_type: :json
)[:data]
transfer_spec.delete('authentication')
transfer_spec.merge!(ts_paths)

test_env.log.debug { Aspera::Log.dump('transfer_spec', transfer_spec) }
# start transfer (asynchronous)
job_id = test_env.agent.start_transfer(transfer_spec)
test_env.log.debug { Aspera::Log.dump('job_id', job_id) }
# wait for all transfer completion (for the example)
result = test_env.agent.wait_for_transfers_completion
#  notify of any transfer error
result.reject { |i| i.eql?(:success) }.each do |e|
  test_env.log.error { "A transfer error occurred: #{e.message}" }
end
