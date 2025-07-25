#!/bin/bash

# Start backend servers
echo "Starting backend servers..."
npx ts-node be.index.ts 8081 &
BE1_PID=$!
npx ts-node be.index.ts 8082 &
BE2_PID=$!
npx ts-node be.index.ts 8083 &
BE3_PID=$!

# Give backends time to start
sleep 2

# Start load balancer
echo "Starting load balancer..."
npx ts-node --files lb.index.ts 90 &
LB_PID=$!

# Give LB time to start and perform health checks
sleep 3

# Send request to load balancer
echo "Sending request to load balancer:"
curl -v http://localhost:90/

# Cleanup: kill all started processes
echo "Stopping servers..."
kill $LB_PID $BE1_PID $BE2_PID $BE3_PID

wait
echo "Done."
