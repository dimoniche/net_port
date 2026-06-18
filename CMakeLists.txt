cmake_minimum_required(VERSION 3.10)

project(project_net_port C)

set(CMAKE_C_STANDARD 11)

if(NOT CMAKE_BUILD_TYPE)
        set(CMAKE_BUILD_TYPE Debug)
endif()

option(NET_PORT_BUILD_SERVER "Build C server (disable for client-only cross-compile)" ON)
option(NET_PORT_BUILD_CLIENT "Build C client" ON)

if(NET_PORT_BUILD_SERVER)
  add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/server)
endif()

if(NET_PORT_BUILD_CLIENT)
  add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/client)
endif()
