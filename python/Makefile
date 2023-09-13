# run make in upper folder to generate this file
include ../config.mak

SRC=src
PYTMP=$(CONFIG_TMPDIR)/pythontst/

# environment required for the samples

# used by test scripts
export CONFIG_SDK_ROOT CONFIG_FSMGR_DIR CONFIG_TRSDK_DIR_ARCH CONFIG_TRSDK_DIR_GENERIC CONFIG_YAML CONFIG_TMPDIR

# avoid incompatibility of version
PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION

all: f5 server faspex node cos cos2 aoc
server: .test_env
	$(SRC)/server.py
faspex: .test_env
	$(SRC)/faspex.py $(PYTMP)This_is_a_test.txt
node: .test_env
	$(SRC)/node.py $(PYTMP)This_is_a_test.txt
cos: .test_env
	$(SRC)/cos.py $(PYTMP)This_is_a_test.txt
cos2: .test_env
	$(SRC)/cos2.py $(PYTMP)This_is_a_test.txt
aoc: .test_env
	$(SRC)/aoc.py 'test package' 1 $(PYTMP)This_is_a_test.txt
f5: .test_env
	$(SRC)/faspex5.py 'test package' 1 $(PYTMP)This_is_a_test.txt
$(CONFIG_TRSDK_DIR_GENERIC)/connectors/python/requirements.txt ../config.mak:
	@echo "run make in upper folder to install transfer SDK"
	exit 1
.test_env: .is_installed_tmp .is_installed_libs
tmp: .is_installed_tmp
.is_installed_tmp:
	mkdir -p $(PYTMP)
	date > $(PYTMP)This_is_a_test.txt
	dd of=$(PYTMP)1G.bin bs=1k seek=$$((1024*1024)) count=0
	touch $@
libs: .is_installed_libs
.is_installed_libs: $(CONFIG_TRSDK_DIR_GENERIC)/connectors/python/requirements.txt
	#pip3 install -r $(CONFIG_TRSDK_DIR_GENERIC)/connectors/python/requirements.txt
	pip3 install grpcio protobuf google
	pip3 install requests PyYAML pyjwt cryptography
	touch $@
#sdk: .is_installed_sdk
#.is_installed_sdk: 
#	mkdir -p $(CONFIG_FSMGR_DIR)
#	curl -s http://download.asperasoft.com/download/sw/sdk/faspmanager/python/faspmanager-sdk-python-3.7.2-d787953b521f059412ad1713afaa38ccbb760a47.zip -o $(CONFIG_FSMGR_DIR)/faspmanager-sdk-python-3.7.2.zip
#	unzip -d $(CONFIG_FSMGR_DIR) $(CONFIG_FSMGR_DIR)/faspmanager-sdk-python-3.7.2.zip
#	#ln -s noarch $(CONFIG_TRSDK_ROOT)/etc
#	touch $@
# TODO: remove when transfersdk fixed: the "ln -s" is because of bug in transfer sdk: it requires "etc" even if property "etc" is set in config file
clean:
	rm -f .is_installed_libs .is_installed_tmp
	rm -fr $(PYTMP) $(CONFIG_FSMGR_DIR)
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
stop:
	killall asperatransferd || true