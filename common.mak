GBL_FILE_PATHS=$(DIR_TOP)config/paths.yaml
# main folder for generated/downloaded files/temporary files
GBL_DIR_TMP=$(DIR_TOP)$(shell sed -n -e 's/^temp: //p' $(GBL_FILE_PATHS))/
# location of transfer.proto
SDK_FILE_PROTO=$(DIR_TOP)$(shell sed -n -e 's/^proto: //p' $(GBL_FILE_PATHS))
# user's config file path
GBL_FILE_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^main_config: //p' $(GBL_FILE_PATHS))
# folder with architecture independent files from the transfer SDK
SDK_DIR_DEV=$(DIR_TOP)$(shell sed -n -e 's/^sdk_dev: //p' < $(GBL_FILE_PATHS))/
# location of extracted transfer SDK
SDK_DIR_RUNTIME=$(DIR_TOP)$(shell sed -n -e 's/^sdk_runtime: //p' $(GBL_FILE_PATHS))/
# name of the current platform (os-cpu)
PLATFORM=$(shell sed -n -e 's/^ *platform: //p' $(GBL_FILE_CONFIG) 2> /dev/null)
# downloaded SDK file
SDK_FILE_ZIP=$(GBL_DIR_TMP)transfer_sdk.zip
# SDK executables
SDK_FILE_EXECS=$(SDK_DIR_RUNTIME)asperatransferd
# required files for running the samples
FILES_RUNTIME=$(GBL_FILE_CONFIG) $(SDK_DIR_RUNTIME)asperatransferd
# template configuration file
GBL_FILE_CONF_TMPL=$(DIR_TOP)config/config.tmpl
# sample file to transfer
GBL_FILE_SAMPLE=$(GBL_DIR_TMP)This_is_a_test.txt
# folder for test flags
DIR_TESTED_FLAG=./.tested/
TEST_FLAGS=$(foreach var,$(TEST_CASES),$(DIR_TESTED_FLAG)$(var))
.PHONY: all clean superclean clean_flags clean_daemon list
all::
list:
	@echo "$(TEST_CASES)"
# clean flags indicating test was run: force re-run of tests only
clean_flags::
	rm -f $(TEST_FLAGS)
# simple clean
clean:: clean_flags clean_daemon
	rm -f $(TMPDIR)/asperatransferd.* $(TMPDIR)/aspera-scp-transfer*.log
	rm -fr $(DIR_TESTED_FLAG)
# clean all generated and compiled files
superclean:: clean
clean_daemon:
	killall -q asperatransferd||:
$(GBL_FILE_SAMPLE):
	mkdir -p $(GBL_DIR_TMP)
	@echo "Generating test file: $(GBL_FILE_SAMPLE)"
	date > $(GBL_FILE_SAMPLE)
	# dd if=/dev/zero of=$(GBL_FILE_SAMPLE) bs=1k count=3
$(DIR_TESTED_FLAG):
	mkdir -p $(DIR_TESTED_FLAG)
# config file info https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
# download transfer SDK
SDK_URL=https://ibm.biz/aspera_transfer_sdk
$(SDK_FILE_ZIP):
	mkdir -p $(GBL_DIR_TMP)
	curl -L $(SDK_URL) -o $(SDK_FILE_ZIP)
# Extract transfer SDK
$(SDK_DIR_RUNTIME)asperatransferd $(SDK_FILE_PROTO): $(SDK_FILE_ZIP)
	rm -fr $(SDK_DIR_RUNTIME) $(SDK_DIR_DEV)
	mkdir -p $(SDK_DIR_RUNTIME)
	unzip -qu $(SDK_FILE_ZIP) '$(PLATFORM)/*' 'noarch/*' -d $(SDK_DIR_RUNTIME)
	mv $(SDK_DIR_RUNTIME)$(PLATFORM)/* $(SDK_DIR_RUNTIME)
	mv $(SDK_DIR_RUNTIME)noarch/aspera* $(SDK_DIR_RUNTIME)
	mv $(SDK_DIR_RUNTIME)noarch $(SDK_DIR_DEV)
	rmdir $(SDK_DIR_RUNTIME)$(PLATFORM)
	test -f $(SDK_FILE_PROTO)
	$(SDK_DIR_RUNTIME)/asperatransferd version | sed -Ee 's|^(.*) version (.*)\..*$$|<product><name>\1</name><version>\2</version></product>|' > $(SDK_DIR_RUNTIME)product-info.mf
	touch $@
$(GBL_FILE_CONFIG):
	mkdir -p $$(dirname $@)
	cp $(GBL_FILE_CONF_TMPL) $@
	@echo 'Created file $@ using template $(GBL_FILE_CONF_TMPL), refer to README.md'
	@echo "\033[5m>>>> Edit and customize $@ <<<<\033[0m"
