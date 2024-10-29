	#!/bin/bash
    set -e
    SDK_LOCATION_URL=https://ibm.biz/sdk_location
    PLATFORM=$1

	curl -L $SDK_LOCATION_URL -o $GBL_DIR_TMPsdk_location.yaml
	grep -B4 'platform: $PLATFORM' $GBL_DIR_TMPsdk_location.yaml|sed -n 's/.*url: *//p' | sort | tail -n1 > $GBL_DIR_TMPsdk_url.txt
	basename $$< $GBL_DIR_TMPsdk_url.txt > $GBL_DIR_TMPsdk_file.txt
	curl -L $$< $GBL_DIR_TMPsdk_url.txt -o $$< $GBL_DIR_TMPsdk_file.txt
	exit 1
	unzip -qu $SDK_FILE_ZIP '$PLATFORM/*' 'noarch/*' -d $SDK_DIR_RUNTIME
	mv $SDK_DIR_RUNTIME$PLATFORM/* $SDK_DIR_RUNTIME
	test -e $SDK_DIR_RUNTIMEaspera-license || mv $SDK_DIR_RUNTIMEnoarch/aspera-license $SDK_DIR_RUNTIME
	mv $SDK_DIR_RUNTIMEnoarch $SDK_DIR_DEV
	rmdir $SDK_DIR_RUNTIME$PLATFORM
	test -f $SDK_FILE_PROTO
	$SDK_DIR_RUNTIME/asperatransferd version | sed -Ee 's|^(.* version (.*\..*$$|<product><name>\1</name><version>\2</version></product>|' > $SDK_DIR_RUNTIMEproduct-info.mf
	echo '<CONF/>' > $SDK_DIR_RUNTIMEaspera.conf
	touch $SDK_DIR_RUNTIMEasperatransferd $SDK_FILE_PROTO
