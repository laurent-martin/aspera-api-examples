DIR_TOP=$(CURDIR)/../
TEST_CASES=ServerFileUploadV1Example ServerFileDownloadV2Example COSFileUploadExample PersistentUploadExample Faspex5Send
include $(DIR_TOP)common.mak
# same as in settings.gradle
PROJECT_NAME=java_samples
# same as in build.gradle
PROJECT_VERSION=0.1
SAMPLE_JAR=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
# cspell:disable
JAVA_PROPS=-Ddir_top=$(DIR_TOP) -Djava.util.logging.config.file=logging.properties
GRADLE_PROPS=-Pproto_file=$(notdir $(PROTO_FILE)) -Pproto_dir=$(dir $(PROTO_FILE)) -Psample_version=$(PROJECT_VERSION)
# cspell:enable
all:: $(TEST_FLAGS)
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	java -cp $(SAMPLE_JAR) $(JAVA_PROPS) client.$(notdir $@)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
$(ENV_IS_SETUP): $(SAMPLE_JAR)
	@touch $@
# uncomment to trigger build on source change
#.PHONY: $(SAMPLE_JAR)
$(SAMPLE_JAR): $(SDK_FILES)
	gradle -version
	gradle build $(GRADLE_PROPS)
clean:: clean_flags
	if test -d .gradle;then gradle clean $(GRADLE_PROPS); fi
superclean::
	rm -fr .gradle bin
