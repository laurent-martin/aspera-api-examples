DIR_TOP=$(realpath ../..)/
TEST_CASES=Aoc Node ServerFileUploadV1Example ServerFileDownloadV2Example PersistentUploadExample Faspex5Send
# COSFileUploadExample
include $(DIR_TOP)common.mak
# same as in settings.gradle
PROJECT_NAME=java_samples
# get version from build.gradle
PROJECT_VERSION=$(shell sed -nEe 's/^version.*"([^"]*)".*/\1/p' build.gradle)
SAMPLE_JAR=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
# cspell:disable
JAVA_PROPS=\
-Ddir_top=$(DIR_TOP) \
-Djava.util.logging.config.file=logging.properties
GRADLE_PROPS=\
-Pproto_file=$(notdir $(SDK_FILE_PROTO)) \
-Pproto_dir=$(dir $(SDK_FILE_PROTO))
# cspell:enable
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(GBL_FILE_SAMPLE) $(FILES_RUNTIME) $(SAMPLE_JAR)
	@echo "== Test: $(notdir $@) ==========================="
	java -cp $(SAMPLE_JAR) $(JAVA_PROPS) examples.$(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
$(SAMPLE_JAR): $(shell find src -name "*.java") build.gradle
	gradle -version
	gradle build $(GRADLE_PROPS)
clean::
	rm -fr .gradle bin
clean_lang:
	if test -d .gradle;then gradle clean $(GRADLE_PROPS); fi
superclean::
	rm -fr build
