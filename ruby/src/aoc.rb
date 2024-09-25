#!/usr/bin/env ruby
# frozen_string_literal: true

require 'aspera/api/aoc'
require_relative 'utils/configuration'

test_env = Configuration.instance

log = test_env.log

aoc_api = Aspera::Api::AoC.new(
  url: "https://#{test_env.conf('aoc', 'org')}.ibmaspera.com",
  auth: :jwt,
  private_key: File.read(test_env.conf('aoc', 'private_key')),
  username: test_env.conf('aoc', 'user_email'),
  scope: 'user:all',
  subpath: 'api/v1'
)

self_user_data = aoc_api.read('self')

log.debug("self: #{self_user_data}")
