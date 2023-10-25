DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
# same as in settings.gradle
PROJECT_NAME=javasamples
# same as in build.gradle
PROJECT_VERSION=0.1
JARFILE=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
JAVA_PROPS=-Ddir_top=$(DIR_TOP) -Djava.util.logging.config.file=logging.properties
GRADLE_PROPS=-Psdk_noarch=$(GLOBAL_TRSDK_NOARCH)
all: ServerFileUploadV1Example$(T) ServerFileDownloadV2Example$(T) COSFileUploadExample$(T) PersistentUploadExample$(T) Faspex5Send$(T)
%$(T): $(JARFILE)
	@echo "== Testing $$(basename $@ $(T)) ==========================="
	java -cp $(JARFILE) $(JAVA_PROPS) client.$$(basename $@ $(T))
	sleep 2
	touch $@
# uncomment to trigger build on source change
#.PHONY: $(JARFILE)
$(JARFILE): ../$(IS_OK)
	gradle build $(GRADLE_PROPS)
# ensure SDK is there
../$(IS_OK):
	cd .. && make
clean:
	gradle clean $(GRADLE_PROPS)
	rm -f .is_tested
	rm -fr .gradle
	rm -f file*
	test -n "$(T)" && rm -f *$(T)
