Name:           domainarr
Version:        0.0.1
Release:        1%{?dist}
Summary:        DNS sync CLI for Pi-hole and Cloudflare

License:        ISC
URL:            https://github.com/ryanbas21/domainarr
Source0:        https://github.com/ryanbas21/domainarr/archive/refs/tags/v%{version}.tar.gz

BuildRequires:  nodejs >= 20
BuildRequires:  npm

Requires:       nodejs >= 20

BuildArch:      noarch

%description
DNS sync CLI for managing Pi-hole and Cloudflare DNS records together.
Keep your local Pi-hole DNS entries synchronized with Cloudflare DNS,
enabling split-horizon DNS where local devices resolve to internal IPs
while external clients use Cloudflare.

%prep
%autosetup -n %{name}-%{version}

%build
npm install --ignore-scripts
npm run build

%install
mkdir -p %{buildroot}%{_libdir}/%{name}
cp -r dist node_modules package.json %{buildroot}%{_libdir}/%{name}/

mkdir -p %{buildroot}%{_bindir}
cat > %{buildroot}%{_bindir}/%{name} << 'EOF'
#!/bin/sh
exec node %{_libdir}/domainarr/dist/main.js "$@"
EOF
chmod +x %{buildroot}%{_bindir}/%{name}

mkdir -p %{buildroot}%{_licensedir}/%{name}
cp LICENSE %{buildroot}%{_licensedir}/%{name}/

%files
%license LICENSE
%{_bindir}/%{name}
%{_libdir}/%{name}

%changelog
* Sun Mar 16 2025 Ryan Bas <ryanbas21@gmail.com> - 0.0.1-1
- Initial package
