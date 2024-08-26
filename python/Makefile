DIR_TOP=$(CURDIR)/../
TEST_CASES=aoc cos  cos_node_api faspex faspex5 node node_v2 shares shares_v2 server
#  cos_v2
include $(DIR_TOP)common.mak
DIR_PYENV=$(CURDIR)/.venv/
SRC=src/
all:: $(TEST_FLAGS)
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	source $(DIR_PYENV)bin/activate && $(SRC)$(notdir $@).py $(SAMPLE_FILE)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
# initialize python environment
$(ENV_IS_SETUP): $(SDK_FILES)
	python3 -m venv $(DIR_PYENV)
	source $(DIR_PYENV)bin/activate && pip3 install -r $(SRC)requirements.txt
	@touch $@
clean::
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
superclean:: clean
	rm -fr $(DIR_PYENV)
