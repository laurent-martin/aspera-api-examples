DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.mak
# same as in settings.gradle
PROJECT_NAME=java_samples
# same as in build.gradle
PROJECT_VERSION=0.1
SAMPLE_JAR=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
# cspell:disable
JAVA_PROPS=-Ddir_top=$(DIR_TOP) -Djava.util.logging.config.file=logging.properties
GRADLE_PROPS=-Psdk_noarch=$(GLOBAL_TRSDK_NOARCH)
# cspell:enable
all:: $(T)ServerFileUploadV1Example $(T)ServerFileDownloadV2Example $(T)COSFileUploadExample $(T)PersistentUploadExample $(T)Faspex5Send
$(T)%: $(IS_OK)
	@name='$@' && echo "== Testing $${name#$(T)} ==========================="
	name='$@' && java -cp $(SAMPLE_JAR) $(JAVA_PROPS) client.$${name#$(T)}
	sleep 2
	@touch $@
$(IS_OK): $(SAMPLE_JAR)
	@touch $@
# uncomment to trigger build on source change
#.PHONY: $(SAMPLE_JAR)
$(SAMPLE_JAR): $(DIR_TOP)$(IS_OK)
	gradle -version
	gradle build $(GRADLE_PROPS)
clean:: clean_flags
	if test -d .gradle;then gradle clean $(GRADLE_PROPS); fi
superclean::
	rm -fr .gradle bin/main
