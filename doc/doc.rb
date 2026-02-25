#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'
require 'uri'
SAMPLE_EMAIL = 'john@example.com'
# Generate a sample configuration file from existing working file.
def generate_config_template
  local_config = ARGV.shift
  template_config = ARGV.shift
  raise 'missing argument: local config file' if local_config.nil?

  o = YAML.load_file(local_config)
  o.each do |k, h|
    next if k.eql?('trsdk')

    h.each do |p, v|
      next unless v.is_a?(String)

      case p
      when 'verify'
        h[p] = false
      when 'url'
        uri = URI.parse(v)
        uri.host = "#{k}.address.here"
        h[p] = uri.to_s
      when 'username', 'user', 'adminuser', 'user_email'
        h[p] = v.include?('@') ? SAMPLE_EMAIL : "_#{p}_here_"
      when 'private_key', 'service_credential_file'
        h[p] = "/path/to/your/#{p}"
      when 'bucket', 'instance', 'key', 'workspace', 'shared_inbox', /pass/, /secret/, /_id$/, /crn/
        h[p] = "_#{p}_here_"
      end
    end
  end
  File.write(template_config, o.to_yaml)
end
