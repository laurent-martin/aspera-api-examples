DIR_TOP=$(shell pwd -P)/../
DIR_PYROOT=$(DIR_TOP)python/
DIR_PYENV=$(DIR_PYROOT).venv/
include $(DIR_TOP)common.mak
SRC=src/
all:: $(T)aoc $(T)cos $(T)cos_v2 $(T)cos_node_api $(T)faspex $(T)faspex5 $(T)node $(T)node_v2 $(T)shares $(T)shares_v2 $(T)server
$(T)%: $(IS_OK)
	@echo "Running test $@"
	source $(DIR_PYENV)bin/activate && name='$@' && $(SRC)$${name#$(T)}.py $(SAMPLE_FILE)
	sleep 2
	@touch $@
# initialize python environment
$(IS_OK): $(DIR_TOP)$(IS_OK)
	python3 -m venv $(DIR_PYENV)
	source $(DIR_PYENV)bin/activate && pip3 install -r $(SRC)requirements.txt
	@touch $@
clean::
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
superclean:: clean
	rm -fr $(DIR_PYENV)
