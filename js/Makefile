# test file to transfer, here generated file, but could be real file with a path
DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.mak
SRC=./
all:: $(T)server $(T)server_v2 $(T)cos
$(T)%: $(IS_OK) $(SAMPLE_FILE)
	name='$@' && node $(SRC)$${name#$(T)}.js $(SAMPLE_FILE)
	sleep 2
	@touch $@
$(IS_OK): $(DIR_TOP)$(IS_OK)
	npm install
	@touch $@
clean::
	rm -f package-lock.json
	rm -fr node_modules tmp
