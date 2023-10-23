DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
all::
# same as in settings.gradle
PROJECT_NAME=javasamples
# same as in build.gradle
PROJECT_VERSION=0.1
JARFILE=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
JAVA_PROPS=\
-Ddaemon=$(CONFIG_TRSDK_DIR_ARCH)asperatransferd \
-Dconfig_daemon=$(CONFIG_TRSDK_CONFIG) \
-Dconfig_yaml=$(MAIN_CONFIG) \
-Djava.util.logging.config.file="logging.properties"
GRADLE_PROPS=\
-Psdk_noarch=$(CONFIG_TRSDK_DIR_GENERIC)
.PHONY: $(JARFILE)
$(JARFILE):
	gradle build $(GRADLE_PROPS)

all:: ServerFileUploadV1Example$(T) ServerFileDownloadV2Example$(T) COSFileUploadExample$(T) PersistentUploadExample$(T) Faspex5Send$(T)
	cd .. && make stopdaemon
%$(T): $(JARFILE)
	@echo "== Testing $$(basename $@ $(T)) ==========================="
	java -cp $(JARFILE) $(JAVA_PROPS) client.$$(basename $@ $(T))
	sleep 2
	touch $@
clean:
	gradle clean $(GRADLE_PROPS)
	rm -fr .gradle
	rm -f file*
	test -n "$(T)" && rm -f *$(T)
