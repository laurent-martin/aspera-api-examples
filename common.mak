ifeq ($(DIR_TOP),)
$(error DIR_TOP is not set. Please set this Makefile macro.)
endif
export DIR_TOP
GBL_FILE_PATHS=$(DIR_TOP)config/paths.yaml
# main folder for generated/downloaded files/temporary files
GBL_DIR_TMP=$(DIR_TOP)$(shell sed -n -e 's/^temp: //p' $(GBL_FILE_PATHS))/
# user's config file path
GBL_FILE_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^main_config: //p' $(GBL_FILE_PATHS))
# location of extracted transfer SDK
SDK_DIR_RUNTIME=$(DIR_TOP)$(shell sed -n -e 's/^sdk_dir: //p' $(GBL_FILE_PATHS))/
# folder with architecture independent files from the transfer SDK
SDK_DIR_EXAMPLES=$(DIR_TOP)$(shell sed -n -e 's/^sdk_samples: //p' < $(GBL_FILE_PATHS))/
# name of the current platform (os-cpu)
PLATFORM=$(shell sed -n -e 's/^ *platform: //p' $(GBL_FILE_CONFIG) 2> /dev/null)
# SDK executables
SDK_NAME_DAEMON=$(shell sed -n -e 's/^sdk_daemon: .*\///p' < $(GBL_FILE_PATHS))
SDK_FILE_DAEMON=$(DIR_TOP)$(shell sed -n -e 's/^sdk_daemon: //p' < $(GBL_FILE_PATHS))
# location of transfer.proto
SDK_FILE_PROTO=$(DIR_TOP)$(shell sed -n -e 's/^proto: //p' $(GBL_FILE_PATHS))
SDK_FILES_REQUIRED=$(SDK_FILE_DAEMON) $(SDK_FILE_PROTO)
# required files for running the samples
FILES_RUNTIME=$(GBL_FILE_CONFIG) $(SDK_FILES_REQUIRED)
# template configuration file
GBL_FILE_CONF_TMPL=$(DIR_TOP)config/config.tmpl
# sample file to transfer
GBL_FILE_SAMPLE=$(GBL_DIR_TMP)This_is_a_test.txt
# folder for test flags
DIR_TESTED_FLAG=./.tested/
TEST_FLAGS=$(foreach var,$(TEST_CASES),$(DIR_TESTED_FLAG)$(var))
.PHONY: all clean superclean clean_flags clean_daemon list
all::
# list of test cases
list:
	@echo "Test individual case with:"
	@for t in $(TEST_CASES);do echo "make $(DIR_TESTED_FLAG)$$t";done
# clean flags indicating test was run: force re-run of tests only
clean_flags::
	rm -f $(TEST_FLAGS)
# simple clean
clean:: clean_flags clean_daemon
	rm -f $(TMPDIR)$(SDK_NAME_DAEMON).* $(TMPDIR)aspera-scp-transfer*.log
	rm -fr $(DIR_TESTED_FLAG)
# clean all generated and compiled files
superclean:: clean
clean_daemon:
	killall -q $(SDK_NAME_DAEMON)||:
$(GBL_DIR_TMP).exists:
	mkdir -p $(GBL_DIR_TMP)
	touch $@
$(GBL_FILE_SAMPLE): $(GBL_DIR_TMP).exists
	@echo "Generating test file: $(GBL_FILE_SAMPLE)"
	date > $(GBL_FILE_SAMPLE)
	# dd if=/dev/zero of=$(GBL_FILE_SAMPLE) bs=1k count=3
$(DIR_TESTED_FLAG):
	mkdir -p $(DIR_TESTED_FLAG)
# config file info https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
# download and extract transfer SDK
$(SDK_FILES_REQUIRED): $(GBL_DIR_TMP).exists
	echo $(SDK_FILES_REQUIRED)
	rm -fr $(SDK_DIR_RUNTIME)
	mkdir -p $(SDK_DIR_RUNTIME)
	$(DIR_TOP)doc/get_sdk.sh $(PLATFORM) $(GBL_DIR_TMP) $(SDK_DIR_RUNTIME) $(SDK_FILE_DAEMON)
	touch -c $(SDK_FILES_REQUIRED)
$(GBL_FILE_CONFIG):
	mkdir -p $$(dirname $@)
	cp $(GBL_FILE_CONF_TMPL) $@
	@echo 'Created file $@ using template $(GBL_FILE_CONF_TMPL), refer to README.md'
	@echo "\033[5m>>>> Edit and customize $@ <<<<\033[0m"
# cspell:ignore killall
