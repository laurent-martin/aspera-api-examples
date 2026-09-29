#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'
require 'uri'
require 'nokogiri'

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

# Names of the tabs of a .drawio file.
def drawio_tab_names(drawio_file)
  Nokogiri::XML(File.read(drawio_file)).xpath('//diagram').map { |diagram| diagram['name'] }
end

# List the images exported from a .drawio file: one per tab, in the same folder, named after the tab.
# Arguments: drawio file, image format (default: png)
def list_drawio_images
  drawio_file = ARGV.shift
  raise 'missing argument: drawio file' if drawio_file.nil?

  format = ARGV.shift || 'png'
  puts(drawio_tab_names(drawio_file).map { |name| File.join(File.dirname(drawio_file), "#{name}.#{format}") })
end

# Export one tab of a .drawio file as an image.
# The tab name is the output file base name, and the format is its extension.
# Remaining arguments are passed to draw.io, e.g. --scale 2 --transparent
def export_drawio_tab
  drawio_file = ARGV.shift
  output_file = ARGV.shift
  raise 'missing argument: output file' if output_file.nil?

  tab_name = File.basename(output_file, '.*')
  page_index = drawio_tab_names(drawio_file).index(tab_name)
  raise "tab not found: #{tab_name} in #{drawio_file}" if page_index.nil?

  # draw.io CLI pages are 0-based (an index out of range silently selects the last page)
  system(
    find_drawio_bin, '--export', '--page-index', page_index.to_s, *ARGV, '--output', output_file, drawio_file,
    exception: true
  )
end

# Find the draw.io desktop executable.
def find_drawio_bin
  candidates =
    case RUBY_PLATFORM
    when /darwin/ then ['/Applications/draw.io.app/Contents/MacOS/draw.io']
    when /mswin|mingw|cygwin/ then ['C:\Program Files\draw.io\draw.io.exe']
    else []
    end
  candidates += ENV.fetch('PATH', '').split(File::PATH_SEPARATOR).map { |dir| File.join(dir, 'drawio') }
  candidates.find { |path| File.executable?(path) } || raise('draw.io not found')
end
