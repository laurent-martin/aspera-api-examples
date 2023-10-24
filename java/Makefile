DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
all: .is_tested
# same as in settings.gradle
PROJECT_NAME=javasamples
# same as in build.gradle
PROJECT_VERSION=0.1
JARFILE=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
JAVA_PROPS=-Ddir_top=$(DIR_TOP) -Djava.util.logging.config.file="logging.properties"
GRADLE_PROPS=-Psdk_noarch=$(GLOBAL_TRSDK_NOARCH)
# uncomment to trigger build on source change
#.PHONY: $(JARFILE)
$(JARFILE): ../.is_setup
	gradle build $(GRADLE_PROPS)
../.is_setup:
	cd .. && make
.is_tested: ServerFileUploadV1Example$(T) ServerFileDownloadV2Example$(T) COSFileUploadExample$(T) PersistentUploadExample$(T) Faspex5Send$(T)
	touch $@
%$(T): $(JARFILE)
	@echo "== Testing $$(basename $@ $(T)) ==========================="
	java -cp $(JARFILE) $(JAVA_PROPS) client.$$(basename $@ $(T))
	sleep 2
	touch $@
clean:
	gradle clean $(GRADLE_PROPS)
	rm -f .is_tested
	rm -fr .gradle
	rm -f file*
	test -n "$(T)" && rm -f *$(T)
