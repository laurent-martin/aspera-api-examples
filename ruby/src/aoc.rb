#!/usr/bin/env ruby
# frozen_string_literal: true

require 'aspera/aoc'
require 'aspera/log'

Aspera::Log.instance.level = :debug

unless ARGV.length.eql?(2)
  logger.error { "Wrong number of args: #{ARGV.length}" }
  logger.error { "Usage: #{$PROGRAM_NAME} <config yaml> <file to send>" }
  Process.exit(1)
end

config_yaml = ARGV[0]
_files_to_send = [ARGV[1]]

all_config = YAML.load_file(config_yaml)
aoc_conf = all_config['aoc']

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
