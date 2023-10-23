SRC=src
PYTMP=$(TMPDIR)/pythontst/
# avoid incompatibility of version
#PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
#export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION

all: aoc.test cos.test cos2.test cos_node_api.test faspex.test faspex5.test node.test server.test
%.test: .test_env
	$(SRC)/$$(basename $@ .test).py $(PYTMP)This_is_a_test.txt
	sleep 2
	touch $@
.test_env:
	mkdir -p $(PYTMP)
	date > $(PYTMP)This_is_a_test.txt
	dd of=$(PYTMP)1G.bin bs=1k seek=$$((1024*1024)) count=0
	#pip3 install -r $(CONFIG_TRSDK_DIR_GENERIC)/connectors/python/requirements.txt
	pip3 install grpcio protobuf google
	pip3 install requests PyYAML pyjwt cryptography
	touch $@
#sdk: .is_installed_sdk
#.is_installed_sdk: 
#	mkdir -p $(CONFIG_FSMGR_DIR)
#	unzip -d $(CONFIG_FSMGR_DIR) $(CONFIG_FSMGR_DIR)/faspmanager-sdk-python-3.7.2.zip
#	#ln -s noarch $(CONFIG_TRSDK_ROOT)/etc
#	touch $@
# TODO: remove when transfersdk fixed: the "ln -s" is because of bug in transfer sdk: it requires "etc" even if property "etc" is set in config file
clean:
	killall asperatransferd || true
	rm -f *.test
	rm -f .test_env
	rm -fr $(PYTMP)
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
