#pragma once

#define ENUM_TO_STRING_BEGIN(enum_name, enum_ns)                \
    namespace enum_ns {                                         \
    inline std::string enum_name##_to_string(enum_name value) { \
        switch (value) {
#define ENUM_TO_STRING_VALUE(enum_name, enum_value) \
    case enum_name ::enum_value:                    \
        return #enum_value;
#define ENUM_TO_STRING_END(enum_name)                              \
    default:                                                       \
        return "Unknown " #enum_name ": " + std::to_string(value); \
        }                                                          \
        }                                                          \
        }
#if 0
// define the enum to string conversion
ENUM_TO_STRING_BEGIN(TransferStatus, transfersdk)
ENUM_TO_STRING_VALUE(TransferStatus, UNKNOWN_STATUS)
ENUM_TO_STRING_VALUE(TransferStatus, QUEUED)
ENUM_TO_STRING_VALUE(TransferStatus, RUNNING)
ENUM_TO_STRING_VALUE(TransferStatus, COMPLETED)
ENUM_TO_STRING_VALUE(TransferStatus, FAILED)
ENUM_TO_STRING_VALUE(TransferStatus, CANCELED)
ENUM_TO_STRING_VALUE(TransferStatus, PAUSED)
ENUM_TO_STRING_VALUE(TransferStatus, ORPHANED)
ENUM_TO_STRING_END(TransferStatus)
#endif
