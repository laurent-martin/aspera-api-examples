DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
# same as in settings.gradle
PROJECT_NAME=javasamples
# same as in build.gradle
PROJECT_VERSION=0.1
JARFILE=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
JAVA_PROPS=-Ddir_top=$(DIR_TOP) -Djava.util.logging.config.file=logging.properties
GRADLE_PROPS=-Psdk_noarch=$(GLOBAL_TRSDK_NOARCH)
all:: $(T)ServerFileUploadV1Example $(T)ServerFileDownloadV2Example $(T)COSFileUploadExample $(T)PersistentUploadExample $(T)Faspex5Send
$(T)%: $(IS_OK)
	@name='$@' && echo "== Testing $${name#$(T)} ==========================="
	name='$@' && java -cp $(JARFILE) $(JAVA_PROPS) client.$${name#$(T)}
	sleep 2
	@touch $@
$(IS_OK): $(JARFILE)
	@touch $@
# uncomment to trigger build on source change
#.PHONY: $(JARFILE)
$(JARFILE): ../$(IS_OK)
	gradle build $(GRADLE_PROPS)
# ensure SDK is there
../$(IS_OK):
	cd .. && make
clean: clean_flags
	if test -d .gradle;then gradle clean $(GRADLE_PROPS); fi
	rm -fr .gradle
