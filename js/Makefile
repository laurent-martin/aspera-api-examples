# test file to transfer, here generated file, but could be real file with a path
DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
SRC=
TSTFILE='faux:///100m?100m'
all:: $(T)server $(T)server_v2 $(T)cos
$(T)%: $(IS_OK)
	name='$@' && node $(SRC)$${name#$(T)}.js $(TSTFILE)
	sleep 2
	@touch $@
../$(IS_OK):
	cd .. && make
$(IS_OK): ../$(IS_OK)
	npm install
	@touch $@
clean: clean_flags
	rm -f package-lock.json
	rm -fr node_modules tmp
