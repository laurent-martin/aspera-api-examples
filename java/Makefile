all::
include ../config.mak
../config.mak:
	@echo "Run make in upper folder to create config.mak"
	@exit 1
# same as in settings.gradle
PROJECT_NAME=javasamples
# same as in build.gradle
PROJECT_VERSION=0.1
JARFILE=build/libs/$(PROJECT_NAME)-$(PROJECT_VERSION)-all.jar
JAVA_PROPS=\
-Ddaemon=$(CONFIG_TRSDK_DIR_ARCH)/asperatransferd \
-Dconfig_daemon=$(CONFIG_TRSDK_CONFIG) \
-Dconfig_yaml=$(CONFIG_YAML)
.PHONY: $(JARFILE)
$(JARFILE):
	gradle build

all:: $(JARFILE)

tests: t1 t2 t3 t4
t1: $(JARFILE)
	java -cp $(JARFILE) $(JAVA_PROPS) client.ServerFileUploadV1Example
t2: $(JARFILE)
	java -cp $(JARFILE) $(JAVA_PROPS) client.ServerFileDownloadV2Example
t3: $(JARFILE)
	java -cp $(JARFILE) $(JAVA_PROPS) client.COSFileUploadExample
t4: $(JARFILE)
	java -cp $(JARFILE) $(JAVA_PROPS) client.PersistentUploadExample 100 100
clean: stop
	gradle clean $(GRADLE_PROPS)
	rm -fr .gradle
	rm -f file*
stop:
	-killall asperatransferd
