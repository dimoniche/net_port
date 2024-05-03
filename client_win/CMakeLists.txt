cmake_minimum_required(VERSION 3.7)
set(CMAKE_TRY_COMPILE_TARGET_TYPE "STATIC_LIBRARY")

project(module_net_port_client C)

set(CMAKE_C_STANDARD 11)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

set(VERSION_MAJOR 0)
set(VERSION_MINOR 0)
set(VERSION_PATCH 1)
set(BUILD_REVISION 0)
set(SOFT_VERSION ${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH})
set(MODULE_NAME module_net_port_client)

include(generate_product_version)
generate_product_version(
        VersionFilesOutputVariable
        NAME ${MODULE_NAME}
        VERSION_MAJOR ${VERSION_MAJOR}
        VERSION_MINOR ${VERSION_MINOR}
        VERSION_PATCH ${VERSION_PATCH}
        VERSION_REVISION ${BUILD_REVISION}
)

set(EXEC_NAME ${MODULE_NAME}-${SOFT_VERSION})

set(CMAKE_SYSTEM_NAME Windows)

#set(CMAKE_C_COMPILER arm-linux-gnueabihf-gcc)
#set(CMAKE_CXX_COMPILER arm-linux-gnueabihf-g++)

# feature checks
include(CheckLibraryExists)
check_library_exists(rt clock_gettime "time.h" CONFIG_SYSTEM_HAS_CLOCK_GETTIME)

# check if we are on a little or a big endian
include(TestBigEndian)
test_big_endian(PLATFORM_IS_BIGENDIAN)

add_subdirectory(common)

include_directories(
        .
        #${CMAKE_CURRENT_LIST_DIR}/proxy/inc
        ${CMAKE_CURRENT_LIST_DIR}/resources/inc
        ${CMAKE_CURRENT_LIST_DIR}/common/inc
        ${PROJECT_BINARY_DIR}
)

add_executable(${EXEC_NAME}
        main.c
        #proxy/client/proxy_client.c
        resources/signal_handler.c
        resources/time_counter.c
)

target_link_libraries(${EXEC_NAME}
        client_proxy_common
        #-lrt
)
