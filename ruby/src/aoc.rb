#!/usr/bin/env ruby
# frozen_string_literal: true

require 'aspera/aoc'
$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..', 'lib'))
require 'test_environment'

aoc_conf = TestEnvironment.instance.config['aoc']

aoc_api = Aspera::AoC.new(
  url: "https://#{aoc_conf['org']}.ibmaspera.com",
  auth: :jwt,
  private_key: File.read(aoc_conf['private_key_path']),
  username: aoc_conf['user_email'],
  scope: 'user:all',
  subpath: 'api/v1'
)

self_user_data = aoc_api.read('self')

Aspera::Log.dump('self', self_user_data)
