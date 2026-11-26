#!/bin/bash
# Download Aspera Transfer SDK
set -ex
if ! test $# -eq 4;then
	echo "Requires 4 args, not $#"
	exit 1
fi
PLATFORM=$1
TMP_DIR=$2
SDK_DIR=$3
DAEMON=$4
SDK_LOCATION_URL=https://ibm.biz/sdk_location
# latest version for the platform: YAML list of entries with keys version, platform, url (in any order)
SDK_URL=$(curl -fsSL $SDK_LOCATION_URL | awk -v platform="$PLATFORM" '
  function flush() { if (pf == platform && url != "") print version, url; version = ""; url = ""; pf = "" }
  /^- / {flush(); sub(/^- /, "  ")}
  $1 == "version:" {version = $2}
  $1 == "platform:" {pf = $2}
  $1 == "url:" {url = $2}
  END {flush()}
' | sort -V | tail -n1 | cut -d' ' -f2)
if test -z "$SDK_URL"; then
	echo "No SDK found for platform: $PLATFORM"
	exit 1
fi
SDK_ARCHIVE=${TMP_DIR}${SDK_URL##*/}
echo "Downloading Aspera Transfer Daemon archive for $PLATFORM from $SDK_URL"
curl -fsSLo $SDK_ARCHIVE $SDK_URL
case $SDK_ARCHIVE in
	*.zip) unzip -qu $SDK_ARCHIVE -d $SDK_DIR;;
	*.tar.gz) tar -xzf $SDK_ARCHIVE -C $SDK_DIR;;
	*) echo "Unknown archive format: $SDK_ARCHIVE"; exit 1;;
esac
# move files from subfolder to SDK_DIR
subfolder=$(ls $SDK_DIR)
mv $SDK_DIR$subfolder/* $SDK_DIR
rm -fr $SDK_DIR$subfolder $SDK_ARCHIVE
# optional: create metadata file
$DAEMON version | sed -Ee 's|^(.*) version (.*\..*)|<product><name>\1</name><version>\2</version></product>|' > ${SDK_DIR}product-info.mf
