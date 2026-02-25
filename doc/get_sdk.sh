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
SDK_URL=$(curl -sL $SDK_LOCATION_URL|grep -B4 "platform: $PLATFORM"|sed -n 's/.*url: *//p' | sort | tail -n1)
SDK_ARCHIVE=${TMP_DIR}${SDK_URL##*/}
echo "Downloading Aspera Transfer Daemon archive for $PLATFORM from $SDK_URL"
curl -sLo $SDK_ARCHIVE $SDK_URL
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
