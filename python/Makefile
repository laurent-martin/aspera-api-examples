DIR_TOP=$(realpath ..)/
TEST_CASES=server aoc faspex faspex5 node shares node_v2
# shares_v2 cos cos_node_api cos_v2
include $(DIR_TOP)common.mak
# python execution environment folder
PYENV_DIR=$(CURDIR)/.venv/
# python virtual environment activation script
PYENV_ACTIVATE=$(PYENV_DIR)bin/activate
# python source code folder
SRC=./src/
# python grpc source code folder used by sample code
PY_DIR_GRPC=$(PYENV_DIR)grpc_aspera/
# this env var is used in test_environment.py
export PY_DIR_GRPC
# python grpc source code files, generated from proto file, also present in SDK
PY_SRCS_GRPC=transfer_pb2.py transfer_pb2_grpc.py
# python grpc source code files used by sample code with full path
PY_FILES_GRPC = $(foreach item,$(PY_SRCS_GRPC),$(PY_DIR_GRPC)$(item))
all:: $(TEST_FLAGS)
# execute one sample
# 1. Ensure SDK is present
# 2. Create python virtual environment and Install required python packages
# 3. Generate or copy python grpc files
# 4. Ensure test file is present
# 5. Run the sample
$(DIR_TESTED_FLAG)%: $(FILES_RUNTIME) $(PYENV_ACTIVATE) $(PY_FILES_GRPC) $(GBL_FILE_SAMPLE) $(SRC)%.py
	@echo "== Test: $(notdir $@) ==========================="
	source $(PYENV_ACTIVATE) && $(SRC)$(notdir $@).py $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
$(PYENV_ACTIVATE):
	python3 -m venv $(PYENV_DIR)
	source $(PYENV_ACTIVATE) && pip3 install -r $(SRC)requirements.txt
# make COMPILE_PROTO=yes
ifdef COMPILE_PROTO
$(PY_FILES_GRPC): $(SDK_FILE_PROTO) $(PYENV_ACTIVATE)
	mkdir -p $(PY_DIR_GRPC)
	source $(PYENV_ACTIVATE) && python -m grpc_tools.protoc \
	  --grpc_python_out=$(PY_DIR_GRPC) \
	  --python_out=$(PY_DIR_GRPC) \
	  --pyi_out=$(PY_DIR_GRPC) \
	  --proto_path=$(dir $(SDK_FILE_PROTO)) \
	  $(SDK_FILE_PROTO)
else
$(PY_FILES_GRPC): $(FILES_RUNTIME)
	mkdir -p $(PY_DIR_GRPC)
	cp $(foreach item,$(PY_SRCS_GRPC),$(SDK_DIR_NOARCH)connectors/python/$(item)) $(PY_DIR_GRPC)
endif
clean::
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
superclean:: clean
	rm -fr $(PYENV_DIR) $(PY_DIR_GRPC)
