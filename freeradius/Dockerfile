FROM freeradius/freeradius-server:3.2.3

# Install PostgreSQL client module
RUN apt-get update && \
    apt-get install -y freeradius-postgresql && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy configuration files
COPY raddb/ /etc/freeradius/3.0/

# Set permissions
RUN chown -R freerad:freerad /etc/freeradius/3.0/

EXPOSE 1812/udp 1813/udp

CMD ["freeradius", "-f"]
